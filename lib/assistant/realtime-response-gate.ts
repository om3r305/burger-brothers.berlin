/** One conversation response at a time; tool mutations only from completed output. */
export function createRealtimeResponseGate(send: () => boolean) {
  let active = "";
  let requested = false;
  let continuation = false;
  const pending = new Set<string>();
  const seen = new Set<string>();
  const finished = new Set<string>();
  function flush() {
    if (active || requested || pending.size || !continuation) return;
    requested = true;
    if (send()) continuation = false;
    else requested = false;
  }
  return {
    created(id: string) { active = id; requested = false; },
    done(response: { id?: string; status?: string; output?: any[] }) {
      const id = response.id || "";
      if (!id || finished.has(id)) return [];
      finished.add(id);
      if (active === id || active === "server-busy") active = "";
      const calls = response.status === "completed" ? (response.output || []).filter(
        item => item.type === "function_call" && item.status === "completed" && typeof item.call_id === "string" && !seen.has(item.call_id),
      ) : [];
      for (const call of calls) { seen.add(call.call_id); pending.add(call.call_id); }
      flush();
      return calls;
    },
    toolFinished(id: string) {
      if (!pending.delete(id)) return;
      continuation = true;
      flush();
    },
    conflict() { requested = false; active = active || "server-busy"; continuation = true; },
    busy() { return Boolean(active || requested || pending.size); },
  };
}
