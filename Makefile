IMAGE := sorting-hat:local
WINDOWS_ARCHIVE := sorting-hat-local-amd64.tar

.PHONY: rebuild build export-windows run stop

rebuild: build export-windows

build:
	docker compose build --pull --no-cache

export-windows:
	docker image inspect $(IMAGE) --format 'Exporting {{.RepoTags}} ({{.Os}}/{{.Architecture}})'
	docker save --output $(WINDOWS_ARCHIVE) $(IMAGE)
	@echo "Created $(WINDOWS_ARCHIVE)"

run:
	docker compose up -d --force-recreate

stop:
	docker compose down
