# -*- coding: utf-8 -*-
"""
岗位拆解 Prompt v2 回归测试
用法:
    export DEEPSEEK_API_KEY=sk-xxxx   (PowerShell: $env:DEEPSEEK_API_KEY="sk-xxxx（历史中的真实key已清除，请使用环境变量注入）")
    python test_prompt.py
产出:
    tests/report.md          自动评分报告
    tests/raw/<岗位>.json    原始模型输出(发给行内人做盲测用)
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime
from difflib import SequenceMatcher

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"
TEMPERATURE = 0.7
MAX_TOKENS = 2000

TEST_JOBS = ["供应链计划员", "审计专员（四大）", "客户成功（SaaS）", "算法工程师", "医药代表"]

# 与 prompt v2 铁律 1 保持一致
BANNED_WORDS = ["负责", "协助", "参与", "相关", "日常", "统筹", "各类", "推动落实"]

FIELD_MIN = {"dailyWork": 5, "kpi": 3, "firstMonthPitfalls": 4, "week1Checklist": 4, "interviewSecrets": 2, "collaboration": 3}


def load_system_prompt():
    """从 prompt-岗位拆解.md 提取第一个代码块作为 System Prompt（单一数据源）"""
    with open(os.path.join(HERE, "prompt-岗位拆解.md"), encoding="utf-8") as f:
        md = f.read()
    m = re.search(r"```\n(.*?)```", md, re.S)
    if not m:
        raise RuntimeError("未在 prompt-岗位拆解.md 中找到 System Prompt 代码块")
    return m.group(1).strip()


def call_deepseek(system_prompt, job_name):
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"岗位：{job_name}"},
        ],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.environ['DEEPSEEK_API_KEY']}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def parse_json(text):
    """剥离可能的 markdown 代码块包裹后解析"""
    text = re.sub(r"^```(json)?\s*|\s*```$", "", text.strip())
    return json.loads(text), text


def check_banned(parsed):
    """铁律1: 禁用词扫描"""
    hits = []
    for field in ["dailyWork", "kpi", "firstMonthPitfalls", "collaboration", "week1Checklist", "interviewSecrets"]:
        for item in parsed.get(field, []):
            for w in BANNED_WORDS:
                if w in item:
                    hits.append(f"{field}: 「{w}」→ {item[:40]}")
    return hits


def check_fields(parsed):
    """各字段条数达标"""
    problems = []
    for field, minimum in FIELD_MIN.items():
        n = len(parsed.get(field, []))
        if n < minimum:
            problems.append(f"{field} 只有 {n} 条 (要求≥{minimum})")
    return problems


def check_specificity(parsed):
    """铁律2: dailyWork 具体度启发式——够长且含数字/量级细节"""
    problems = []
    for i, item in enumerate(parsed.get("dailyWork", [])):
        has_digit = any(c.isdigit() for c in item)
        if len(item) < 20:
            problems.append(f"dailyWork[{i}] 太短({len(item)}字): {item[:30]}")
        elif not has_digit and len(item) < 30:
            problems.append(f"dailyWork[{i}] 疑似缺具体细节: {item[:40]}")
    return problems


def check_genericity(all_outputs):
    """铁律3: 通用性检测——同一句话在多个岗位高度相似即标红"""
    problems = []
    jobs = list(all_outputs.keys())
    for a in range(len(jobs)):
        for b in range(a + 1, len(jobs)):
            for la in all_outputs[jobs[a]].get("dailyWork", []):
                for lb in all_outputs[jobs[b]].get("dailyWork", []):
                    ratio = SequenceMatcher(None, la[:60], lb[:60]).ratio()
                    if ratio > 0.7:
                        problems.append(f"「{jobs[a]}」与「{jobs[b]}」疑似雷同(r={ratio:.2f}): {la[:35]}")
    return problems


def check_honesty(parsed):
    """铁律6: [存疑] 标记统计"""
    n = json.dumps(parsed, ensure_ascii=False).count("[存疑]")
    return n


def main():
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        print("❌ 请先设置环境变量 DEEPSEEK_API_KEY")
        sys.exit(1)

    system_prompt = load_system_prompt()
    os.makedirs(os.path.join(HERE, "tests", "raw"), exist_ok=True)

    outputs, errors = {}, {}
    for job in TEST_JOBS:
        print(f"生成中: {job} ...")
        try:
            raw = call_deepseek(system_prompt, job)
            parsed, cleaned = parse_json(raw)
            outputs[job] = parsed
            with open(os.path.join(HERE, "tests", "raw", f"{job}.json"), "w", encoding="utf-8") as f:
                json.dump(parsed, f, ensure_ascii=False, indent=2)
        except Exception as e:
            errors[job] = str(e)
        # 文件名兜底: Windows 下括号等字符安全
        safe = job.replace("（", "(").replace("）", ")").replace("/", "_")

    lines = [
        "# 岗位拆解 Prompt v2 回归测试报告",
        f"\n> 时间: {datetime.now():%Y-%m-%d %H:%M} | 模型: {MODEL} | temp: {TEMPERATURE}",
        f"\n## 总览: 通过 {len(outputs)}/{len(TEST_JOBS)} 个岗位\n",
    ]

    if errors:
        lines.append("## ❌ 生成失败\n")
        for job, err in errors.items():
            lines.append(f"- **{job}**: {err}\n")

    for job, parsed in outputs.items():
        banned = check_banned(parsed)
        fields = check_fields(parsed)
        spec = check_specificity(parsed)
        doubt = check_honesty(parsed)
        ok = not banned and not fields and not spec
        lines.append(f"\n## {'✅' if ok else '⚠️'} {job}\n")
        lines.append(f"- 禁用词: {'无 ✅' if not banned else str(len(banned)) + ' 处 ❌'}")
        for h in banned:
            lines.append(f"  - {h}")
        lines.append(f"- 字段条数: {'达标 ✅' if not fields else '❌ ' + '; '.join(fields)}")
        lines.append(f"- 具体度: {'达标 ✅' if not spec else '⚠️ ' + '; '.join(spec) if len(spec) < 3 else f'⚠️ {len(spec)} 条待人工复核'}")
        lines.append(f"- [存疑]标记: {doubt} 处（>0 说明模型在诚实地表达不确定）")

    generic = check_genericity(outputs) if len(outputs) > 1 else []
    lines.append(f"\n## 通用性检测\n\n{'未发现跨岗位雷同 ✅' if not generic else ''}")
    for g in generic:
        lines.append(f"- ❌ {g}")

    lines.append("\n## 下一步（人工盲测，脚本替代不了）\n")
    lines.append("把 tests/raw/*.json 发给做对应岗位的同学，只问一句：**像不像真的？哪里不像？**")
    lines.append("把'不像的地方'改写成 prompt 新铁律，追加进 prompt-岗位拆解.md 的迭代记录，版本号 +0.1。\n")

    with open(os.path.join(HERE, "tests", "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"\n报告已生成: tests/report.md")
    print("原始输出: tests/raw/*.json （发给人做盲测）")


if __name__ == "__main__":
    main()
