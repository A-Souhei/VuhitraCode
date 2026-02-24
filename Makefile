.PHONY: dev docs setup test-privacy install-dev install

setup:
	npm i -g mintlify
	bun install

dev:
	bun run --cwd packages/opencode --conditions=browser src/index.ts

docs:
	cd packages/docs && mintlify dev --port 3333

install-dev:
	@echo '#!/bin/bash' > ~/.local/bin/opencode-dev
	@echo 'PKGDIR="$(CURDIR)/packages/opencode"' >> ~/.local/bin/opencode-dev
	@echo 'if [ ! -d "$$PKGDIR" ]; then echo "Error: project not found at $$PKGDIR — re-run make install-dev" >&2; exit 1; fi' >> ~/.local/bin/opencode-dev
	@echo 'BUN=$$(command -v bun); [ -n "$$BUN" ] || { echo "Error: bun not found in PATH" >&2; exit 1; }' >> ~/.local/bin/opencode-dev
	@echo 'exec "$$BUN" run --cwd "$$PKGDIR" --conditions=browser src/index.ts "$$@"' >> ~/.local/bin/opencode-dev
	@chmod +x ~/.local/bin/opencode-dev
	@echo "Installed: opencode-dev → $(CURDIR)/packages/opencode/src/index.ts"

install:
	@mkdir -p ~/.local/bin
	@sed 's|/home/toavina/Apps/opencode/packages/opencode|$(CURDIR)/packages/opencode|g' packages/opencode/bin/vuhitracode > ~/.local/bin/vuhitracode
	@chmod +x ~/.local/bin/vuhitracode
	@echo "Installed: vuhitracode → ~/.local/bin/vuhitracode"

test-privacy:
	bun test --cwd packages/opencode test/util/faker.test.ts test/tool/read.test.ts
