.PHONY: dev docs setup test-privacy install-dev

setup:
	npm i -g mintlify
	bun install

dev:
	~/.bun/bin/bun run --cwd packages/opencode --conditions=browser src/index.ts

docs:
	cd packages/docs && mintlify dev --port 3333

install-dev:
	@echo '#!/bin/bash' > ~/.local/bin/opencode-dev
	@echo "exec ~/.bun/bin/bun run --cwd $(CURDIR)/packages/opencode --conditions=browser src/index.ts \"\$$@\"" >> ~/.local/bin/opencode-dev
	@chmod +x ~/.local/bin/opencode-dev
	@echo "Installed: opencode-dev → $(CURDIR)/packages/opencode/src/index.ts"

test-privacy:
	~/.bun/bin/bun test --cwd packages/opencode test/util/faker.test.ts test/tool/read.test.ts
