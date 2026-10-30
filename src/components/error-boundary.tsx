import React from "react";
import { Button } from "./ui/button";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      localStorage.setItem(
        "mail-last-frontend-error",
        JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: info.componentStack,
          at: new Date().toISOString(),
        }),
      );
    } catch {
      // 错误页本身不能再依赖本地存储。
    }
    console.error(error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal-error" role="alert">
        <h1>页面渲染出错</h1>
        <p>
          邮件数据没有被修改。可以先重新加载；如果仍出现，请把下面的错误发给开发者。
        </p>
        <pre>{this.state.error.message}</pre>
        <Button onClick={() => location.reload()}>重新加载</Button>
      </div>
    );
  }
}
