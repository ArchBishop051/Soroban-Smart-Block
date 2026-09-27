import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./Card";
import { Button } from "./Button";

const meta: Meta<typeof Card> = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "elevated", "bordered"],
    },
    padding: {
      control: "select",
      options: ["none", "sm", "md", "lg"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    variant: "default",
    padding: "md",
    children: (
      <div>
        <h3 style={{ marginBottom: "var(--spacing-2)" }}>Card Title</h3>
        <p style={{ color: "var(--color-text-secondary)" }}>
          This is a default card with standard padding and border.
        </p>
      </div>
    ),
  },
};

export const Elevated: Story = {
  args: {
    variant: "elevated",
    padding: "md",
    children: (
      <div>
        <h3 style={{ marginBottom: "var(--spacing-2)" }}>Elevated Card</h3>
        <p style={{ color: "var(--color-text-secondary)" }}>
          This card has a shadow for elevation effect.
        </p>
      </div>
    ),
  },
};

export const Bordered: Story = {
  args: {
    variant: "bordered",
    padding: "md",
    children: (
      <div>
        <h3 style={{ marginBottom: "var(--spacing-2)" }}>Bordered Card</h3>
        <p style={{ color: "var(--color-text-secondary)" }}>
          This card has a thicker border for emphasis.
        </p>
      </div>
    ),
  },
};

export const WithActions: Story = {
  args: {
    variant: "default",
    padding: "md",
    children: (
      <div>
        <h3 style={{ marginBottom: "var(--spacing-2)" }}>Card with Actions</h3>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "var(--spacing-4)" }}>
          This card includes action buttons.
        </p>
        <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
        </div>
      </div>
    ),
  },
};
