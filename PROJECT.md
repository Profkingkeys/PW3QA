# PW3QA — Hybrid WebView Integration

## Overview

PW3QA explores a browser-to-Android networking bridge for hybrid applications.

## Architecture

```text
Web application
      ↓
fetch / XMLHttpRequest
      ↓
Android bridge when available
      ↓
Native Android HTTP layer

Browser fallback
      ↓
native fetch / XHR
```

## Stack

JavaScript · Android WebView · Java/Kotlin integration patterns · Fetch · XMLHttpRequest

## Engineering signal

The project demonstrates runtime detection, compatibility layers, asynchronous request handling and a native/web boundary that does not force the rest of the application to know which runtime it is using.
