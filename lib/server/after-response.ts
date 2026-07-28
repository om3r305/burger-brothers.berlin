import { after } from "next/server";

type AfterResponseTask = () => void | Promise<void>;

function isMissingRequestScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("called outside a request scope") ||
    message.includes("next-dynamic-api-wrong-context")
  );
}

export function runAfterResponse(task: AfterResponseTask): void {
  const guardedTask = async () => {
    try {
      await task();
    } catch (error) {
      console.error("[after-response] background task failed", error);
    }
  };

  try {
    after(guardedTask);
  } catch (error) {
    if (!isMissingRequestScopeError(error)) throw error;
    void Promise.resolve().then(guardedTask);
  }
}
