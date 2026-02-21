.PHONY: dev docs setup

setup:
	npm i -g mintlify
	bun install

dev:
	bun run --cwd packages/opencode --conditions=browser src/index.ts

docs:
	cd packages/docs && mintlify dev --port 3333
