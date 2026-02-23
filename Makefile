.PHONY: dev docs setup test-privacy install-dev install

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

install:
	@echo '#!/bin/bash' > ~/.local/bin/vuhitracode
	@echo 'PKGDIR=$(CURDIR)/packages/opencode' >> ~/.local/bin/vuhitracode
	@echo 'export OPENCODE_CLI_NAME=vuhitracode' >> ~/.local/bin/vuhitracode
	@echo 'if [ $$# -eq 0 ]; then' >> ~/.local/bin/vuhitracode
	@echo '  exec ~/.bun/bin/bun run --cwd "$$PKGDIR" --conditions=browser src/index.ts "$$PWD"' >> ~/.local/bin/vuhitracode
	@echo 'else' >> ~/.local/bin/vuhitracode
	@echo '  exec ~/.bun/bin/bun run --cwd "$$PKGDIR" --conditions=browser src/index.ts "$$@"' >> ~/.local/bin/vuhitracode
	@echo 'fi' >> ~/.local/bin/vuhitracode
	@chmod +x ~/.local/bin/vuhitracode
	@echo "Installed: vuhitracode → $(CURDIR)/packages/opencode/src/index.ts"

test-privacy:
	~/.bun/bin/bun test --cwd packages/opencode test/util/faker.test.ts test/tool/read.test.ts
