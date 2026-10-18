import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MailReaderWindow } from "./components/mail-reader-window";
import "./index.css";

// 阅读窗口是 Rust 建出来的独立原生窗口（label 形如 mail-window-N），加载的是同一份
// 前端产物，所以这里按窗口 label 分流：只有主窗口渲染整个应用。
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
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
