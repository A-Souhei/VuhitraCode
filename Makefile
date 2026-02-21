.PHONY: dev docs setup test-privacy

setup:
	npm i -g mintlify
	bun install

dev:
	bun run --cwd packages/opencode --conditions=browser src/index.ts

docs:
	cd packages/docs && mintlify dev --port 3333

test-privacy:
	~/.bun/bin/bun test --cwd packages/opencode test/util/faker.test.ts test/tool/read.test.ts
