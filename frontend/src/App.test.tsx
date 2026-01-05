import { render } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("should render without crashing", () => {
    const { container } = render(() => <App />);
    expect(container).toBeTruthy();
  });

  it("should render the main content", () => {
    const { container } = render(() => <App />);
    const main = container.querySelector("main");
    expect(main).toBeInTheDocument();
  });
});
