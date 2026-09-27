# Design System Exceptions

This document lists the components and files that are exempt from the design token enforcement rule. These exceptions exist because the components operate in contexts where DOM-based styling is not applicable or feasible.

## 3D Graph Components

The following components use WebGL/Three.js for 3D visualization and cannot use CSS design tokens:

- `src/components/ContractDependencyGraph3D.tsx` - 3D contract dependency visualization using Three.js
- `src/components/AddressConnectionGraph.tsx` - 3D address connection graph
- `src/components/DependencyVisualizer.tsx` - General dependency visualization

**Reason**: These components render to a WebGL canvas and use Three.js materials, colors, and positioning that are not CSS-based. Hardcoded values are necessary for the 3D rendering context.

## Monaco Editor Components

The following components use the Monaco Editor (VS Code's editor component) which has its own theming system:

- `src/components/Editor.tsx` - Monaco-based code editor
- `src/components/Terminal.tsx` - Monaco-based terminal emulator
- `src/components/FileExplorer.tsx` - Monaco-based file tree

**Reason**: Monaco Editor uses its own token-based theming system that is separate from CSS. The editor's internal styling is controlled by Monaco's theme definitions, not CSS variables.

## WebContainer Components

The following components interact with WebContainer which runs in an iframe with its own environment:

- `src/services/webcontainer.ts` - WebContainer API service
- `src/services/sandbox-api.ts` - Sandbox API for WebContainer
- `src/services/dependencies.ts` - Dependency management for WebContainer

**Reason**: These services manage code execution in an isolated iframe environment. Styling within the iframe is controlled by the WebContainer runtime, not the parent application's CSS.

## Test Files

All test files are exempt from design token enforcement:

- `test/**/*.test.{ts,tsx}` - Unit and integration tests
- `test/**/*.spec.{ts,tsx}` - Specification tests

**Reason**: Tests may use arbitrary values for testing purposes and should not be constrained by design system rules.

## Storybook Files

All Storybook story files are exempt:

- `src/**/*.stories.{ts,tsx}` - Component stories

**Reason**: Stories may need to test edge cases with arbitrary values for documentation purposes.

## ESlint Rule Files

The lint rule files themselves are exempt:

- `eslint-rules/**` - Custom ESLint rules

**Reason**: The lint rule implementation files cannot be subject to the rule they implement.

## Adding New Exceptions

To add a new exception:

1. Add the file pattern to the `allowedFiles` array in `frontend/eslint.config.js`
2. Document the reason in this file following the format above
3. Ensure the exception is justified by one of the reasons listed above

## Migration Path

For components currently exempt that could potentially use design tokens:

1. **3D Graph**: Consider if UI overlays (tooltips, labels) can use design tokens
2. **Monaco**: Use Monaco's theme API to sync with the app's theme
3. **WebContainer**: Pass theme variables to the iframe via postMessage

These are future improvements and should be tracked as separate issues.
