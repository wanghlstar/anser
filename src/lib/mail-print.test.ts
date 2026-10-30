// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDemo } from "./demo";
import { printableMail, printMail } from "./mail-print";
import type { Detail } from "./types";

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.enabled,
  invoke: native.invoke,
}));

const mail = makeDemo().messages[0];
const detail: Detail = {
  mail,
  html: '<style>body{display:none}</style><p>打印正文</p><script>window.bad=1</script><img src="https://images.example/photo.png" onerror="window.bad=2">',
  attachments: [
    { index: 0, name: "收据.pdf", size: 42, mime: "application/pdf" },
  ],
};

afterEach(() => {
  native.enabled = false;
  native.invoke.mockReset();
  document.getElementById("mail-print-root")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mail printing", () => {
  it("prepares only the selected message with safe body and attachment names", () => {
    const sheet = printableMail(detail);
    expect(sheet.querySelector("h1")?.textContent).toBe(mail.subject);
    const body = sheet.querySelector(".mail-print-body")!.shadowRoot!;
    expect(body.textContent).toContain("打印正文");
    expect(sheet.textContent).toContain("收据.pdf");
    expect(sheet.querySelector("style,link")).toBeNull();
    expect(body.querySelector("script,[onerror]")).toBeNull();
    expect(body.querySelector("img")?.getAttribute("referrerpolicy")).toBe(
      "no-referrer",
    );
  });

  it("uses the native A4 print command in a desktop window", async () => {
    native.enabled = true;
    native.invoke.mockResolvedValue(undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await printMail({ ...detail, html: "", attachments: [] });
    expect(native.invoke).toHaveBeenCalledWith("print_mail");
    expect(print).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("afterprint"));
    expect(document.getElementById("mail-print-root")).toBeNull();
  });

  it("opens the system print action and clears the temporary sheet afterward", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await printMail({ ...detail, html: "", attachments: [] });
    expect(print).toHaveBeenCalledOnce();
    expect(document.getElementById("mail-print-root")?.textContent).toContain(
      mail.body,
    );
    window.dispatchEvent(new Event("afterprint"));
    expect(document.getElementById("mail-print-root")).toBeNull();
  });
});
