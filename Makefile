PLUGIN_ID     := com.narlei.nowplaying.ulanziPlugin
INSTALL_BASE  := $(HOME)/Library/Application Support/Ulanzi/UlanziDeck/Plugins
INSTALL_DIR   := $(INSTALL_BASE)/$(PLUGIN_ID)
DIST_DIR      := dist
ZIP           := $(DIST_DIR)/$(PLUGIN_ID).zip
APP_NAME      := Ulanzi Studio
APP_PROC      := UlanziDeck

.PHONY: help package install restart clean icon banners bump_major bump_minor bump_patch

CHROME := /Applications/Google Chrome.app/Contents/MacOS/Google Chrome

help:
	@echo "Available targets:"
	@echo "  make package     - Build a distributable ZIP at $(ZIP)"
	@echo "  make install     - Sync plugin + restart $(APP_NAME)"
	@echo "  make restart     - Restart $(APP_NAME) only"
	@echo "  make icon        - Regenerate resources/icon.png"
	@echo "  make banners     - Regenerate store art (cover + banners)"
	@echo "  make clean       - Remove $(DIST_DIR)/"
	@echo "  make bump_patch  - Bump patch version"

package: clean
	@echo "→ Reinstalling production deps in $(PLUGIN_ID)..."
	@rm -rf "$(PLUGIN_ID)/node_modules"
	@cd "$(PLUGIN_ID)" && npm install --omit=dev --silent
	@mkdir -p $(DIST_DIR)
	@zip -r "$(ZIP)" "$(PLUGIN_ID)" -x "*.DS_Store"
	@echo "✅ $(ZIP) created."

# Copy (not symlink) the plugin into UlanziDeck, bundling node_modules — this
# mirrors exactly how the Community Store ZIP is installed (self-contained, no
# dependency on this repo's location or an external volume staying mounted).
install:
	@if [ ! -d "$(PLUGIN_ID)/node_modules" ]; then \
		echo "→ Installing deps..."; \
		cd "$(PLUGIN_ID)" && npm install --omit=dev --silent; \
	fi
	@echo "→ Installing $(PLUGIN_ID) to $(INSTALL_DIR)..."
	@mkdir -p "$(INSTALL_DIR)"
	@rsync -a --delete --exclude=".DS_Store" --exclude="*.log" "$(PLUGIN_ID)/" "$(INSTALL_DIR)/"
	@$(MAKE) restart

restart:
	@echo "→ Restarting $(APP_NAME)..."
	@killall "$(APP_PROC)" 2>/dev/null || true
	@for i in 1 2 3 4 5; do \
		pgrep -x "$(APP_PROC)" >/dev/null 2>&1 || break; \
		sleep 1; \
	done
	@pkill -x "$(APP_PROC)" 2>/dev/null || true
	@sleep 1
	@open -a "$(APP_NAME)" || echo "⚠️ Could not open $(APP_NAME). Please start it manually."

icon:
	@cd "$(PLUGIN_ID)" && node tools/gen-icon.mjs

# Regenerate the store art. sips can't rasterize SVG and qlmanage softens edges
# at these sizes, so Chrome headless renders each SVG at its exact pixel size.
banners:
	@cd "$(PLUGIN_ID)" && node tools/gen-banners.mjs
	@if [ ! -x "$(CHROME)" ]; then echo "⚠️  Google Chrome not found — SVGs written, PNGs skipped."; exit 1; fi
	@cd resources && for spec in "cover 1600 800" "banner1 2400 1600" "banner2 2400 1600"; do \
		set -- $$spec; \
		printf '<html><head><style>*{margin:0;padding:0}html,body{width:%spx;height:%spx;overflow:hidden}img{display:block;width:%spx;height:%spx}</style></head><body><img src="file://%s/%s.svg"></body></html>' \
			"$$2" "$$3" "$$2" "$$3" "$$PWD" "$$1" > "/tmp/np_$$1.html"; \
		"$(CHROME)" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
			--window-size=$$2,$$3 --screenshot="$$1.png" "file:///tmp/np_$$1.html" 2>/dev/null; \
		echo "  ✓ resources/$$1.png ($$2x$$3)"; \
	done
	@echo "✅ store art regenerated."

clean:
	@rm -rf $(DIST_DIR)

bump_major bump_minor bump_patch:
	@TYPE=$$(echo $@ | sed s/bump_//); \
	cd $(PLUGIN_ID) && npm version $$TYPE --no-git-tag-version --silent; \
	NEW_VER=$$(node -p "require('./package.json').version"); \
	node -e "\
		const fs = require('fs'); \
		const m = JSON.parse(fs.readFileSync('manifest.json')); \
		m.Version = '$$NEW_VER'; \
		fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n'); \
	"; \
	echo "✓ Version bumped to $$NEW_VER (package.json + manifest.json)"
