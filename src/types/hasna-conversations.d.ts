declare module "@hasna/conversations" {
  export function send_message(opts: {
    space: string;
    text: string;
  }): unknown;
}
