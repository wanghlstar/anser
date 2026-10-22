// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationReader } from "./conversation-reader";
import { makeDemo } from "../lib/demo";
import type { Detail, Mail } from "../lib/types";

const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../lib/api", () => ({ call: backend.call, newDraft: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
let resizeStream: () => void;
let selectedOffset: number;
let nextFrame: FrameRequestCallback;
let selected: Detail;
const scrollRef = createRef<HTMLDivElement>();

async function resize() {
  await act(async () => {
    resizeStream();
    nextFrame(0);
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  selected = {
    mail: { ...makeDemo().messages[0], conversationCount: 41 },
    html: "",
    attachments: [],
  };
  selectedOffset = 24;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private changed: () => void) {}
      observe(element: Element) {
        if (element.classList.contains("conversation-stream"))
          resizeStream = this.changed;
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top =
        this.dataset.mailId === selected.mail.id
          ? selectedOffset - (scrollRef.current?.scrollTop || 0)
          : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 600,
        bottom: top + 100,
        width: 600,
        height: 100,
        toJSON() {},
      };
    },
  );
  backend.call.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the selected header in view as a long conversation loads, then releases on wheel", async () => {
  let deliver!: (list: Mail[]) => void;
  backend.call.mockImplementation((command: string, args: { id: string }) => {
    if (command === "mail_conversation")
      return new Promise<Mail[]>((resolve) => {
        deliver = resolve;
      });
    if (command === "mail_detail")
      return Promise.resolve({
        ...selected,
        mail: { ...selected.mail, id: args.id },
      });
    return Promise.resolve([]);
  });
  const noop = vi.fn();
  await act(async () =>
    root.render(
      <ConversationReader
        selected={selected}
        revision={[]}
        accounts={[]}
        demo
        editorOpen
        scrollRef={scrollRef}
        onReply={noop}
        onEdit={noop}
        onSent={noop}
        onExport={noop}
        onAttachment={async () => {}}
        onAction={noop}
        onLink={noop}
        onMeetingApp={noop}
      />,
    ),
  );
  Object.defineProperties(scrollRef.current!, {
    scrollHeight: { value: 60000 },
    clientHeight: { value: 500 },
  });
  await resize();
  expect(scrollRef.current?.scrollTop).toBe(24);
  selectedOffset = 40000;
  await act(async () =>
    deliver([
      ...Array.from({ length: 40 }, (_, index) => ({
        ...selected.mail,
        id: `older-${index}`,
      })),
      selected.mail,
    ]),
  );
  await resize();
  expect(host.querySelectorAll(".conversation-turn")).toHaveLength(41);
  expect(scrollRef.current?.scrollTop).toBe(40000);
  await act(async () => {
    scrollRef.current!.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true }),
    );
    scrollRef.current!.scrollTop = 10000;
    scrollRef.current!.dispatchEvent(new Event("scroll"));
  });
  selectedOffset = 50000;
  await resize();
  expect(scrollRef.current?.scrollTop).toBe(10000);
});

it("offers to add a meeting from plain text without resending", async () => {
  selected = {
    mail: {
      ...selected.mail,
      body: "会议时间：2026/10/16 14:31-15:31 (GMT+08:00)\n\n点击链接直接加入会议：\nhttps://meeting.tencent.com/dm/lW9AXeR8BUpk\n\n#腾讯会议：849-511-867",
    },
    html: "",
    attachments: [],
  };
  backend.call.mockImplementation((command: string) =>
    command === "save_meeting_event"
      ? Promise.resolve({})
      : Promise.resolve([]),
  );
  const noop = vi.fn();
  await act(async () =>
    root.render(
      <ConversationReader
        selected={selected}
        singleMessage
        revision={[]}
        accounts={[]}
        demo
        editorOpen
        scrollRef={scrollRef}
        onReply={noop}
        onEdit={noop}
        onSent={noop}
        onExport={noop}
        onAttachment={async () => {}}
        onAction={noop}
        onLink={noop}
        onMeetingApp={noop}
      />,
    ),
  );
  expect(host.textContent).toContain("检测到腾讯会议");
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("添加到日历"))
      ?.click();
  });
  expect(backend.call).toHaveBeenCalledWith(
    "save_meeting_event",
    expect.objectContaining({
      event: expect.objectContaining({
        sourceMailId: selected.mail.id,
        meetingUrl: "https://meeting.tencent.com/dm/lW9AXeR8BUpk",
        meetingCode: "849-511-867",
        reminderMinutes: 15,
      }),
    }),
  );
});

it("falls back to the meeting link when the app is unavailable", async () => {
  selected = {
    mail: {
      ...selected.mail,
      body: "会议时间：2026/10/16 14:31-15:31 (GMT+08:00)\n\n点击链接直接加入会议：\nhttps://meeting.tencent.com/dm/lW9AXeR8BUpk\n\n#腾讯会议：849-511-867",
    },
    html: "",
    attachments: [],
  };
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const noop = vi.fn();
  const onMeetingApp = vi.fn(() => Promise.resolve(false));
  const onLink = vi.fn();
  await act(async () =>
    root.render(
      <ConversationReader
        selected={selected}
        singleMessage
        revision={[]}
        accounts={[]}
        demo
        editorOpen
        scrollRef={scrollRef}
        onReply={noop}
        onEdit={noop}
        onSent={noop}
        onExport={noop}
        onAttachment={async () => {}}
        onAction={noop}
        onLink={onLink}
        onMeetingApp={onMeetingApp}
      />,
    ),
  );
  const join = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("加入会议"),
  );
  expect(join).not.toBeUndefined();
  await act(async () => join!.click());
  expect(writeText).toHaveBeenCalledWith("849-511-867");
  expect(onMeetingApp).toHaveBeenCalledWith("tencent");
  expect(onLink).toHaveBeenCalledWith(
    "https://meeting.tencent.com/dm/lW9AXeR8BUpk",
  );
});

it("copies a meeting code and opens the meeting app when no link exists", async () => {
  selected = {
    mail: {
      ...selected.mail,
      body: "会议时间：2026/10/19 16:10-17:10 (GMT+08:00)\n\n#企业微信会议：491-185-654",
    },
    html: "",
    attachments: [],
  };
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const noop = vi.fn();
  const onMeetingApp = vi.fn();
  await act(async () =>
    root.render(
      <ConversationReader
        selected={selected}
        singleMessage
        revision={[]}
        accounts={[]}
        demo
        editorOpen
        scrollRef={scrollRef}
        onReply={noop}
        onEdit={noop}
        onSent={noop}
        onExport={noop}
        onAttachment={async () => {}}
        onAction={noop}
        onLink={noop}
        onMeetingApp={onMeetingApp}
      />,
    ),
  );
  expect(host.textContent).toContain("检测到企业微信会议");
  const copy = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("复制会议号"),
  );
  expect(copy).not.toBeUndefined();
  await act(async () => copy!.click());
  expect(writeText).toHaveBeenCalledWith("491-185-654");
  const join = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("加入会议"),
  );
  expect(join).not.toBeUndefined();
  await act(async () => join!.click());
  expect(writeText).toHaveBeenCalledWith("491-185-654");
  expect(onMeetingApp).toHaveBeenCalledWith("wecom");
});
