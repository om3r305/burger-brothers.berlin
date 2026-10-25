package berlin.burgerbrothers.shell;

/** A visible modal consumes Back before WebView history, independent of button text. */
final class DialogBackScript {
    static final String SCRIPT = "(() => { const dialogs = [...document.querySelectorAll('[role=dialog]')].filter(e => e.getClientRects().length); const dialog = dialogs[dialogs.length - 1]; if (!dialog) return false; const visible = b => !b.disabled && b.getClientRects().length; const button = [...dialog.querySelectorAll('[data-bb-dialog-close]')].find(visible) || [...dialog.querySelectorAll('button')].find(b => visible(b) && /^(Schließen|Abbrechen|Erst Menü ansehen)$/.test(b.textContent.trim())); if (button) { button.click(); return true; } window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true})); return true; })()";
    private DialogBackScript() {}
}
