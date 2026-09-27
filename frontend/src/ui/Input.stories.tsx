import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    disabled: {
      control: "boolean",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    label: "Email",
    placeholder: "Enter your email",
  },
};

export const WithError: Story = {
  args: {
    label: "Email",
    placeholder: "Enter your email",
    error: "Please enter a valid email address",
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Password",
    type: "password",
    helperText: "Must be at least 8 characters",
  },
};

export const Small: Story = {
  args: {
    label: "Small input",
    size: "sm",
  },
};

export const Large: Story = {
  args: {
    label: "Large input",
    size: "lg",
  },
};

export const Disabled: Story = {
  args: {
    label: "Disabled input",
    disabled: true,
    value: "Cannot edit",
  },
};
