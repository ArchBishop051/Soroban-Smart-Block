import type { Preview } from "@storybook/react";
import React from "react";
import "../src/index.css";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    a11y: {
      config: {
        rules: [
          {
            id: "color-contrast",
            enabled: true,
          },
          {
            id: "button-name",
            enabled: true,
          },
          {
            id: "label",
            enabled: true,
          },
        ],
      },
    },
  },
  globalTypes: {
    theme: {
      description: "Global theme for components",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Dark", left: "🌙" },
          { value: "light", title: "Light", left: "☀️" },
          { value: "high-contrast", title: "High Contrast", left: "👁️" },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story: any, context: any) => {
      const { theme } = context.globals;
      const themeValue = theme === "light" ? "light" : theme === "high-contrast" ? "high-contrast" : "dark";
      
      return React.createElement("div", { "data-theme": themeValue }, React.createElement(Story));
    },
  ],
};

export default preview;
