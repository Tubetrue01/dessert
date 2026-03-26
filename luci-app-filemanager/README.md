# luci-app-filemanager

A lightweight, modern file management solution for OpenWrt and ImmortalWrt.

## Introduction
If you are looking for a minimalist plugin for simple file handling, **luci-app-filemanager** is your best assistant. It provides a clean and responsive interface for essential operations:

<p align="left">
    <img width="1000" src="https://github.com/Tubetrue01/luci-app-filemanager/blob/main/img/1774514766322.jpg">
</p>


*   **Upload**: Quickly transfer files from your local device to the router.
*   **Download**: Retrieve files directly from the router's storage.
*   **Install**: Support for one-click installation of packages (e.g., from the `/tmp` directory).

## Background
This project is a tribute to the classic **luci-app-filetransfer** project. While respecting the original concept, it has been completely re-engineered using a **new engine (JavaScript/JSON-RPC)** to ensure full compatibility and high performance on modern OpenWrt systems.

## Compatibility Note
*   **Supported**: Modern OpenWrt versions (21.x, 23.x, 24.x, and ImmortalWrt).
*   **Unsupported**: The older **18.06 series** (and earlier) is not supported due to the lack of modern LuCI client-side APIs.


