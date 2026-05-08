// Diálogos modales propios para reemplazar window.prompt / window.confirm.
// API:  await ui.prompt(title, defaultValue)  → string | null
//       await ui.confirm(title, message?)     → boolean

type PromptReq = {
  kind: 'prompt';
  title: string;
  defaultValue: string;
  resolve: (v: string | null) => void;
};
type ConfirmReq = {
  kind: 'confirm';
  title: string;
  message: string;
  danger: boolean;
  resolve: (v: boolean) => void;
};
type AlertReq = {
  kind: 'alert';
  title: string;
  message: string;
  resolve: (v: true) => void;
};
type Req = PromptReq | ConfirmReq | AlertReq;

class DialogStore {
  current = $state<Req | null>(null);

  prompt(title: string, defaultValue = ''): Promise<string | null> {
    return new Promise((resolve) => {
      this.current = { kind: 'prompt', title, defaultValue, resolve };
    });
  }

  confirm(title: string, message = '', opts: { danger?: boolean } = {}): Promise<boolean> {
    return new Promise((resolve) => {
      this.current = { kind: 'confirm', title, message, danger: !!opts.danger, resolve };
    });
  }

  alert(title: string, message = ''): Promise<true> {
    return new Promise((resolve) => {
      this.current = { kind: 'alert', title, message, resolve };
    });
  }

  /** Resuelve el modal actual con el valor dado y lo cierra. */
  resolve(value: string | null | boolean) {
    const c = this.current;
    if (!c) return;
    this.current = null;
    if (c.kind === 'prompt') c.resolve(value as string | null);
    else if (c.kind === 'alert') c.resolve(true);
    else c.resolve(value as boolean);
  }
}

export const ui = new DialogStore();
