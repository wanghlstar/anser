import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ComposeWindow } from "./components/compose-window";
import { MailReaderWindow } from "./components/mail-reader-window";
import "./index.css";

// 阅读窗/写信窗都是 Rust 建出来的独立原生窗口（label 形如 mail-window-N /
// compose-window-N），加载的是同一份前端产物，所以这里按窗口 label 分流：
// 只有主窗口渲染整个应用。
function windowLabel() {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        metadata?: { currentWindow?: { label?: string } };
      };
    }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? "main";
}

const label = windowLabel();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {label.startsWith("mail-window-") ? (
      <MailReaderWindow label={label} />
    ) : label.startsWith("compose-window-") ? (
      <ComposeWindow label={label} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
