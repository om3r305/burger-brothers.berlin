"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
  label?: string;
  onReset?: () => void;
};

type State = { failed: boolean; message: string };

export default class ShowcaseErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return {
      failed: true,
      message: error instanceof Error ? error.message : "Bilinmeyen render hatası",
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("[showcase:error-boundary]", error, info.componentStack);
  }

  reset = () => {
    this.setState({ failed: false, message: "" });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-[320px] place-items-center rounded-2xl border border-red-700/50 bg-red-950/30 p-6 text-center">
        <div>
          <div className="text-4xl">⚠️</div>
          <h3 className="mt-3 text-lg font-black text-white">
            {this.props.label || "Bu sahnenin önizlemesi oluşturulamadı"}
          </h3>
          <p className="mt-2 max-w-xl text-sm text-red-200">{this.state.message}</p>
          <button onClick={this.reset} className="mt-4 rounded-xl bg-red-500 px-4 py-2 text-sm font-black text-white">
            Önizlemeyi yeniden dene
          </button>
        </div>
      </div>
    );
  }
}
