import type { Config } from "jest";

// Workspace uses a split-environment test config so pure-logic tests
// stay fast (node) while component tests get a DOM to mount into.
//
// To add a COMPONENT test that mounts React:
//   - Name the file ``<Component>.test.tsx`` (anything under src/**)
//   - Add this directive at the top of the file:
//
//       /**
//        * @jest-environment jsdom
//        */
//
//   - Then use @testing-library/react to render and assert.
//
// ts-jest's JSX transform is configured below: tsconfig says
// ``jsx: preserve`` (Next.js handles JSX in prod), so for tests we
// override to ``react-jsx`` inline. No separate tsconfig.jest.json
// needed.

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node", // default — component tests opt in via @jest-environment jsdom
  roots: ["<rootDir>/src"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
        },
      },
    ],
  },
};

export default config;
