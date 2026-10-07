import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import Portfolio from "./Portfolio";

describe("graph navigation", () => {
  it("opens a node section and returns to the overview", async () => {
    const { container } = render(() => <Portfolio />);
    const node = container.querySelectorAll(".node-label")[2] as HTMLButtonElement;
    fireEvent.click(node);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Things I’ve built." })).toBeInTheDocument()
    );
    expect(screen.getByText("JCompile")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to overview/ }));
    expect(screen.getByRole("heading", { name: "Parth Sharma" })).toBeInTheDocument();
    expect(container.querySelectorAll(".node-label")).toHaveLength(5);
  });
});
