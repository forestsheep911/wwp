// Some mobile input methods finish composition immediately before Enter.
export function createSearchSubmitGuard(now = () => Date.now()) {
  let composing = false;
  let compositionEndedAt = -Infinity;
  let lastQuery = "";
  let lastSubmitAt = -Infinity;
  return {
    compositionStart() { composing = true; },
    compositionEnd() { composing = false; compositionEndedAt = now(); },
    blocksEnter(nativeComposing = false, keyCode = 0) {
      return composing || nativeComposing || keyCode === 229 || now() - compositionEndedAt < 200;
    },
    accept(query: string, loading: boolean) {
      const value = query.trim();
      if (!value || loading || composing || now() - compositionEndedAt < 200) return false;
      if (value === lastQuery && now() - lastSubmitAt < 500) return false;
      lastQuery = value;
      lastSubmitAt = now();
      return true;
    }
  };
}
