# Webb App

The web-app for Webb.

### Tech Choices

- Zustand
- Zod
- Floating ui
- tailwind
- nextjs
- pnpm
- Github actions
- prettier
- eslint i guess
- react hook form
- ahooks
- lodash/ramda i guess
- graphql/apollo ?
  - The NextJS model w/ React Server Components is cool but it doesn't feel like it can
    scale too well past a very narrow tech stack. E.g. my current tech stack at work
    would not fit very cleanly into a "NextJS serverless deployed on Vercel" model.
  - GraphQL genuinely does help with the same problems that e.g. protobufs do, with the
    added benefit of hyper-flexibility in data shape.
  - The codegen aspect is generally quite atrocious, and I deeply dislike the output of
    the codegen passes. GQL changes cause merge conflicts incessantly and the type definitions
    aren't too great
  - ApolloCache model is relatively usable
  - Apollo's React library is OK but does not feel very reliable.
