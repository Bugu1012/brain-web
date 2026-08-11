# -*- coding: utf-8 -*-
"""Create a small demo Obsidian vault for release-candidate preview."""
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path


def write_once(path: Path, content: str) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True, help="demo vault path")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    today = date.today().isoformat()
    dirs = [
        "01-收件箱",
        "02-项目",
        "03-资源/电子图书馆/演示书架",
        "03-资源/读书笔记",
        "04-领域",
        "05-日记/说说/images",
    ]
    for item in dirs:
        (vault / item).mkdir(parents=True, exist_ok=True)

    write_once(vault / "欢迎使用松涧听澜.md", """---
tags: [松涧听澜, 发布候选版]
---

# 欢迎使用松涧听澜

这是发布候选版自动创建的演示 Obsidian Vault。你可以先直接查看门户，再把 `BRAIN_WEB_VAULT` 改成自己的 Vault 路径。

[[02-项目/待办看板]] 里有一组演示任务，[[04-领域/个人助手设计]] 里有主题与助手方向的讨论入口。
""")

    write_once(vault / "02-项目" / "待办看板.md", """---
type: kanban
---

# 待办看板

## 今日

- [ ] 试用松涧主题
- [ ] 切换二次元主题
- [ ] 在设置页填入 Obsidian Local REST API Key

## 进行中

- [ ] 讨论个人助手的常驻入口与视觉人格

## 完成

- [x] 打开发布候选版
""")

    write_once(vault / "04-领域" / "个人助手设计.md", """# 个人助手设计

## 方向

- 本地优先：Vault、日记、看板、图书馆、时间轴都以本机文件为边界。
- 低打扰：默认展示今日、近期、待办和检索入口，不把页面做成广告式首页。
- 可换皮肤：松涧、二次元、夜读、书房、专注五个主题先作为候选。

## 待讨论

助手入口可以放在右下角主题控件旁，也可以做成侧栏底部的常驻按钮。前者轻，后者更像系统能力。
""")

    write_once(vault / "03-资源" / "读书笔记" / "演示读书笔记.md", """---
source:
tags: [读书笔记, 演示]
category: 演示
rating: 4
---

# 演示读书笔记

这里用于确认图书馆笔记、Markdown 渲染、标签与搜索效果。

> 发布候选版默认不绑定真实书库，避免误扫用户文件。
""")

    write_once(vault / "05-日记" / f"{today}.md", f"""---
date: {today}
tags: [演示, 松涧听澜]
---

# {today}

今天打开发布候选版，检查主题、看板、时间轴、搜索和设置页。

- 主题：松涧、二次元、夜读、书房、专注
- 目标：一键启动后能在浏览器查看
""")

    write_once(vault / "05-日记" / "说说" / f"{today}-demo.md", f"""---
type: moment
date: {today}
time: "09:30"
photos: []
---

发布候选版预览启动完成。
""")

    print(str(vault))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
