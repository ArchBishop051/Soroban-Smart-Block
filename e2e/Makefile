.PHONY: setup install test e2e-scenarios test-api test-chaos test-property test-playwright test-k6 test-synthetic test-visual test-all help

help:
	@echo "E2E Test Suite — Soroban Smart Block Explorer"
	@echo ""
	@echo "Setup:"
	@echo "  make setup              Setup environment (one-time)"
	@echo "  make install            Install dependencies"
	@echo ""
	@echo "Individual Tests:"
	@echo "  make test-api           API integration tests (~2 min)"
	@echo "  make test-chaos         Chaos engineering tests (~5 min)"
	@echo "  make test-property      Property-based tests (~10 min)"
	@echo "  make test-playwright    Browser tests (~10 min, all browsers)"
	@echo "  make test-k6            k6 load tests (~6 min total)"
	@echo "  make test-k6-baseline   Baseline load test (~5 min, 100 req/s)"
	@echo "  make test-k6-spike      Spike test (~50 sec, 2000 req/s)"
	@echo "  make test-k6-soak       Soak test (~4 hours, 200 req/s)"
	@echo "  make test-synthetic     Synthetic event monitoring"
	@echo "  make test-visual        Percy visual regression (~15 min)"
	@echo "  make e2e-scenarios      Seeded local-network workload + manifest assertions (<15 min)"
	@echo ""
	@echo "Combined:"
	@echo "  make test               Fast E2E (API + chaos + property + playwright, ~30 min)"
	@echo "  make test-full          Full suite (everything, ~5 hours)"
	@echo ""
	@echo "Debugging:"
	@echo "  make test-playwright-debug   Run Playwright in debug mode"
	@echo "  make logs                     Tail service logs"
	@echo "  make clean                    Remove test artifacts"

setup:
	@bash setup.sh

install:
	npm ci
	npx playwright install --with-deps

test:
	npm run test:e2e

test-api:
	npm run test:api

test-chaos:
	npm run test:chaos

test-property:
	npm run test:property

test-playwright:
	npm run test:playwright

test-playwright-debug:
	npm run test:playwright:debug

test-k6:
	npm run test:k6

test-k6-baseline:
	k6 run test/load/baseline.js

test-k6-spike:
	k6 run test/load/spike.js

test-k6-soak:
	k6 run test/load/soak.js

test-synthetic:
	npm run test:synthetic

test-visual:
	npm run test:visual

test-full:
	npm run test:full

logs:
	@echo "Watching test output..."
	@tail -f indexer.log frontend.log

clean:
	rm -rf playwright-report test-results k6-results *.log coverage
	find . -name ".DS_Store" -delete

.DEFAULT_GOAL := help

# Seeded workload against stellar/quickstart (--standalone) — see workloads/ and README.
e2e-scenarios:
	npm run workload -- --seed $${WORKLOAD_SEED:-42}
	npm run test:scenarios
