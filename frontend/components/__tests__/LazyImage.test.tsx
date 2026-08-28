import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import LazyImage from "../LazyImage";

/** Minimal IntersectionObserver mock that lets a test fire the intersecting callback on demand. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }
  observe = jest.fn();
  disconnect = jest.fn();
  unobserve = jest.fn();
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

describe("LazyImage", () => {
  const originalIO = global.IntersectionObserver;

  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    // @ts-expect-error - test double
    global.IntersectionObserver = MockIntersectionObserver;
  });

  afterEach(() => {
    global.IntersectionObserver = originalIO;
  });

  it("does not render an <img> until it intersects the viewport", () => {
    render(<LazyImage src="/images/project-types/tree.svg" alt="Reforestation" width={40} height={40} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the <img> once IntersectionObserver reports it's in view", async () => {
    render(<LazyImage src="/images/project-types/tree.svg" alt="Reforestation" width={40} height={40} />);
    const observer = MockIntersectionObserver.instances[0];
    observer.trigger(true);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Reforestation" })).toBeInTheDocument();
    });
  });

  it("disconnects the observer once it has triggered, so it doesn't re-fire", () => {
    render(<LazyImage src="/images/project-types/tree.svg" alt="Reforestation" width={40} height={40} />);
    const observer = MockIntersectionObserver.instances[0];
    observer.trigger(true);
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("falls back to eager loading when IntersectionObserver is unavailable", () => {
    // @ts-expect-error - simulate an environment without IO support
    delete global.IntersectionObserver;
    render(<LazyImage src="/images/project-types/tree.svg" alt="Reforestation" width={40} height={40} />);
    expect(screen.getByRole("img", { name: "Reforestation" })).toBeInTheDocument();
  });
});
