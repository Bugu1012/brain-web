import { useEffect, useState } from "react";
import { clearKey as clearStoredKey, getKey, hasKey, ping, setKey } from "../lib/api.js";
import { toast } from "../components/Toast.jsx";

export default function Settings() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("idle");
  const [configured, setConfigured] = useState(hasKey());

  useEffect(() => {
    if (hasKey()) {
      setStatus("checking");
      ping().then((p) => setStatus(p.authed ? "ok" : p.reachable ? "badkey" : "off"));
    }
  }, []);

  async function testAndSave() {
    const k = input.trim();
    if (!k) { toast("请粘贴密钥", "info"); return; }
    const prev = getKey();
    setKey(k);
    setStatus("checking");
    const p = await ping();
    const next = p.authed ? "ok" : p.reachable ? "badkey" : "off";
    if (next === "ok") {
      setConfigured(true);
      toast("连接成功，密钥仅保留在当前浏览器会话", "ok");
      setInput("");
    } else {
      if (prev) setKey(prev);
      else clearStoredKey();
      setConfigured(!!prev);
      if (next === "badkey") toast("密钥无效，已保留原密钥，请重新复制插件密钥", "err");
      else toast("连接失败：请确认 Obsidian 已启动，并已安装启用 Local REST API 插件（未保存该密钥）", "err");
    }
    if (next !== "ok" && prev) {
      const p2 = await ping();
      setStatus(p2.authed ? "ok" : p2.reachable ? "badkey" : "off");
    } else setStatus(next === "badkey" && !prev ? "idle" : next);
  }

  function clearConfiguredKey() {
    clearStoredKey();
    setConfigured(false);
    setStatus("idle");
    toast("已清除本地密钥", "ok");
  }

  const badge = {
    ok: ["已连接", "text-[var(--color-para-area)] bg-[rgba(61,145,88,.12)] border-[rgba(61,145,88,.35)]"],
    off: ["未连接", "text-[var(--color-seal)] bg-[rgba(192,72,63,.12)] border-[rgba(192,72,63,.4)]"],
    badkey: ["密钥无效", "text-[var(--color-para-project)] bg-[rgba(217,164,65,.12)] border-[rgba(217,164,65,.4)]"],
    checking: ["检测中…", "text-[var(--color-paper-dim)] bg-[rgba(96,125,104,.1)] border-[rgba(96,125,104,.25)]"],
    idle: ["未配置", "text-[var(--color-para-project)] bg-[rgba(217,164,65,.12)] border-[rgba(217,164,65,.35)]"],
  }[status];

  return (
    <div className="px-7 py-6 max-w-[760px] mx-auto space-y-4 stagger">
      <h1 className="font-display text-[31px] font-black tracking-wide">设置</h1>

      <section className="panel p-6">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="font-display text-[20px] font-bold">Obsidian 连接</h2>
          <span className={"text-[14px] px-2 py-[3px] rounded-full border " + badge[1]}>{badge[0]}</span>
          <span className="ml-auto text-[14.5px] text-[var(--color-paper-faint)] font-mono">http://127.0.0.1:27123</span>
        </div>

        <label className="text-[14.5px] text-[var(--color-paper-faint)]">API 密钥（Bearer Token）</label>
        <div className="flex gap-2 mt-1.5">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") testAndSave(); }}
            placeholder={configured ? "已配置 · 粘贴新密钥可覆盖" : "粘贴 Obsidian Local REST API 的密钥"}
            className="ink-input flex-1 px-3 py-2.5 text-[15.5px] font-mono"
          />
          <button onClick={testAndSave} className="btn-ink px-4 py-2 text-[15.5px]">保存并测试</button>
          {configured && <button onClick={clearConfiguredKey} className="btn-ghost px-3 py-2 text-[15.5px]">清除</button>}
        </div>
        <div className="mt-3 text-[14px] text-[var(--color-paper-faint)] leading-relaxed">
          密钥不会由门户读取、传输或写入 localStorage；它只保留在当前浏览器会话，关闭该门户标签页后需重新粘贴。密钥由 Obsidian Local REST API 插件生成，只有重装插件或手动重置才会改变。
        </div>
      </section>

      <section className="panel p-6">
        <h2 className="font-display text-[20px] font-bold mb-3">如何获取密钥</h2>
        <ol className="space-y-2 text-[15.5px] text-[var(--color-paper-dim)] list-decimal pl-5 leading-relaxed">
          <li>打开 Obsidian → 设置 → 第三方插件 → 浏览，安装并启用 <span className="text-[var(--color-paper)]">Local REST API</span></li>
          <li>插件设置中确认「Enable Non-encrypted (HTTP) Server」已开启，端口 27123</li>
          <li>复制插件设置页顶部的 API Key，粘贴到上方输入框</li>
          <li>点击「保存并测试」，状态变为「已连接」即可</li>
        </ol>
      </section>

      <section className="panel p-6">
        <h2 className="font-display text-[20px] font-bold mb-3">安装支持</h2>
        <div className="space-y-3 text-[15.5px] text-[var(--color-paper-dim)] leading-relaxed">
          <div>
            <div className="font-medium text-[var(--color-paper)]">Obsidian API Key</div>
            <div className="text-[14.5px] text-[var(--color-paper-faint)]">
              如果状态是“未连接”，先确认 Obsidian 已打开、Local REST API 插件已启用、HTTP 端口是 27123；如果状态是“密钥无效”，回插件设置页重新复制 API Key。
            </div>
          </div>
          <div>
            <div className="font-medium text-[var(--color-paper)]">OCR</div>
            <div className="text-[14.5px] text-[var(--color-paper-faint)]">
              粘贴图片识别使用浏览器内置 Tesseract 语言包；屏幕框选 OCR 需要 Python Pillow。若提示缺少 Pillow，在候选版目录运行 <code>.venv\Scripts\python.exe -m pip install -r requirements.txt</code>，或在 .env 设置 <code>BRAIN_WEB_INSTALL_OPTIONAL_DEPS=1</code> 后重新运行启动脚本。
            </div>
          </div>
        </div>
      </section>

      <section className="panel p-6">
        <h2 className="font-display text-[20px] font-bold mb-3">关于本门户</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[15px]">
          <div className="text-[var(--color-paper-faint)]">Vault 位置</div>
          <div className="text-[var(--color-paper-dim)] font-mono">由 BRAIN_WEB_VAULT 环境变量指定</div>
          <div className="text-[var(--color-paper-faint)]">门户服务</div>
          <div className="text-[var(--color-paper-dim)] font-mono">http://127.0.0.1:8765（启动门户.bat）</div>
          <div className="text-[var(--color-paper-faint)]">数据流向</div>
          <div className="text-[var(--color-paper-dim)]">全部本机，无云端上传；Git 版不内置云笔记同步</div>
          <div className="text-[var(--color-paper-faint)]">阶段</div>
          <div className="text-[var(--color-paper-dim)]">方案 C · 依托 Obsidian + supermemory 图谱组件</div>
        </div>
      </section>
    </div>
  );
}
