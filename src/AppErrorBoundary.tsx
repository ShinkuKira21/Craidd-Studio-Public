import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[craidd] Window rendering failed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="h-screen w-screen flex items-center justify-center bg-zinc-950 p-6 text-zinc-200">
      <div className="w-full max-w-lg rounded-lg border border-red-900/70 bg-zinc-900 p-6 shadow-2xl">
        <h1 className="text-base font-medium">This IDE window could not render</h1>
        <p className="mt-2 text-sm text-zinc-400">Your files on disk are unaffected. Reload this window to try again.</p>
        <pre className="mt-4 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-950 p-3 text-xs text-red-300">{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.reload()}
          className="mt-5 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">Reload window</button>
      </div>
    </main>;
  }
}
