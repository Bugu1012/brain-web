# -*- coding: utf-8 -*-
"""发布候选包静态检查。运行：python tests/test_release_hygiene.py"""
import os
import py_compile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_SUFFIXES = {".py", ".pyw", ".js", ".jsx", ".mjs", ".css", ".json", ".bat", ".md", ".html"}
EXCLUDED = {"node_modules", ".git", "__pycache__"}
FORBIDDEN = (r"D:\My-Brain", r"E:\hope260707", '"/obsidian_key"')

passed = failed = 0

def check(name, fn):
    global passed, failed
    try:
        fn()
        passed += 1
        print("  通过 " + name)
    except Exception as exc:
        failed += 1
        print("  失败 " + name + " :: " + str(exc)[:240])

def iter_source_files():
    for dp, dns, fns in os.walk(ROOT):
        dns[:] = [d for d in dns if d not in EXCLUDED]
        for fn in fns:
            if os.path.splitext(fn)[1].lower() in SOURCE_SUFFIXES:
                yield os.path.join(dp, fn)

def p01_compile():
    for rel in ("serve_portal.pyw", "scripts/bootstrap_demo_vault.py", "scripts/build_index.py", "scripts/verify_rest_api.py"):
        py_compile.compile(os.path.join(ROOT, rel), doraise=True)
check("P01 Python 源码可编译", p01_compile)

def p02_no_personal_paths_or_key_endpoint():
    hits = []
    for full in iter_source_files():
        # 本检查器自身保存的是待检模式，不是发布内容；跳过以免模式匹配自身。
        if os.path.abspath(full) == os.path.abspath(__file__):
            continue
        text = open(full, encoding="utf-8", errors="replace").read()
        for marker in FORBIDDEN:
            if marker in text:
                hits.append(os.path.relpath(full, ROOT) + ": " + marker)
    assert not hits, "发现发布前必须清除的标记：" + "; ".join(hits)
check("P02 无个人路径与旧密钥端点", p02_no_personal_paths_or_key_endpoint)

def p03_release_boundary():
    for name in (".venv", "state", "demo_vault", "export", "sync_staging", "_backups", "backups"):
        assert not os.path.exists(os.path.join(ROOT, name)), "发布包不应含运行数据目录：" + name
    www = os.path.join(ROOT, "www")
    if os.path.isdir(www):
        assert os.path.isfile(os.path.join(www, "index.html")), "www 只允许作为已构建前端预览产物"
        assert not os.path.exists(os.path.join(www, "cache")), "www/cache 属于可由 Vault 重建的运行缓存"
    assert not os.path.exists(os.path.join(ROOT, ".env")), "不得含本机环境文件"
check("P03 运行数据与凭证已剥离", p03_release_boundary)

def p04_runtime_configuration_and_dependencies():
    portal = open(os.path.join(ROOT, "serve_portal.pyw"), encoding="utf-8").read()
    assert 'VAULT_ENV = "BRAIN_WEB_VAULT"' in portal
    assert 'PORT_ENV = "BRAIN_WEB_PORTAL_PORT"' in portal
    assert 'PORTAL_AUTH_ENV = "BRAIN_WEB_PORTAL_AUTH"' in portal
    assert os.path.isfile(os.path.join(ROOT, ".env.example"))
    assert os.path.isfile(os.path.join(ROOT, "tools", "memory-graph", "LICENSE"))
    assert not os.path.exists(os.path.join(ROOT, "tools", "youdaonote-pull"))
    package = open(os.path.join(ROOT, "frontend", "package.json"), encoding="utf-8").read()
    assert '"file:../tools/memory-graph"' in package
check("P04 可配置路径与本地依赖齐备", p04_runtime_configuration_and_dependencies)

def p05_gitignore():
    ignore = open(os.path.join(ROOT, ".gitignore"), encoding="utf-8").read()
    for rule in (".env", "frontend/node_modules/", "state/", "demo_vault/", "*.log"):
        assert rule in ignore, "缺少忽略规则：" + rule
check("P05 Git 忽略规则覆盖隐私边界", p05_gitignore)

def p06_no_youdao_sync_surface():
    hits = []
    for full in iter_source_files():
        if os.path.abspath(full) == os.path.abspath(__file__):
            continue
        rel = os.path.relpath(full, ROOT)
        text = open(full, encoding="utf-8", errors="replace").read()
        if "有道" in text or "youdao" in text.lower() or "BRAIN_WEB_YOUDAO" in text:
            hits.append(rel)
    assert not hits, "Git 版不应包含有道同步入口：" + "; ".join(hits[:12])
check("P06 Git 版无有道同步入口", p06_no_youdao_sync_surface)

print("发布候选包检查")
print("\n结果: 通过 %d / 失败 %d" % (passed, failed))
raise SystemExit(1 if failed else 0)
