#!/bin/bash

nuitka3 \
    --follow-imports \
    --include-plugin-directory=images \
    --standalone \
    --onefile \
    --plugin-enable=pyside6 \
    --windows-icon-from-ico=images/128.ico \
    --output-dir=output \
    main.py
