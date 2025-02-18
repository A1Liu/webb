# WIP App Framework
An app framework designed for building apps without a cloud or central source of truth.
Takes local-first design ideas from [Automerge](https://automerge.org/),
and some ideas about computation from [Userland](https://www.youtube.com/watch?v=gla830WPBVU) and Plan 9.

Strict design requirements:
- Synchronize data across multiple devices and platforms, without a cloud server/central repository
- Never interact with ANY cloud compute except as opt-in
- Enable safe interaction with untrusted and partially-trusted devices
- Be resilient against attacks from unauthorized actors
- Enable direct sharing of device capabilities, e.g. compute, storage, camera
- Make data encryption & protection easy

Strong design goals:
- Behave reasonably well in low memory environments
- Full functionality without ever having an internet connection
- Support HSM, biometric auth, and other forms of hardware authentication/encryption
- Adapt to changing capabilities (low battery, camera disabled, etc)
- Enable hot-loading applications via `iframe`, `window.postMessage` (maybe allow something with WASM for server-ish workloads as well)
- Lots of cross platform support: Android, iOS, desktop, browser plugin, server

## Projects
- Notes.md - A WIP notes app which implements synchronization over WebRTC and protects notes from spyware on untrusted devices.
  Being used as MVP app to iterate on framework designs.
- Upcoming: Library app - A library/inventory management app
- Upcoming: Browser extension - Add version of platform which integrates with Firefox, running e.g. WASM

## Resources
- Visidata - https://visidata.org
- LibreOffice plugins - https://www.libreoffice.org/discover/calc
- WebRTC considerations - https://bloggeek.me/webrtc-rtcpeerconnection-one-per-stream/
- WebRTC Leaks (public IP leak via STUN server/ICE exchange)
  - https://www.security.org/vpn/webrtc-leak/
  - https://nordvpn.com/blog/webrtc/
- iOS setup - https://dev.to/adimac93/tauri-mobile-for-ios-4dp6
- Getting client IP in AWS Lambda - https://stackoverflow.com/questions/67777518/get-users-ip-address-in-lambda-with-api-gateway-and-python

### IO
- Virtual Camera with CoreMediaIO - https://developer.apple.com/documentation/coremediaio
- Mounting userspace-managed file system with FUSE - https://github.com/jmillikin/rust-fuse

### Auth
- WebAuthn - https://webauthn.guide/
- Biometric auth - https://stackoverflow.blog/2022/11/16/biometric-authentication-for-web-devs/
- Authenticator rs - https://github.com/mozilla/authenticator-rs/
- https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/Platform_vs_Cross-Platform.html
- MacOS/iOS LocalAuthentication - https://lib.rs/crates/localauthentication-rs
- Yubikey HSM - https://github.com/iqlusioninc/yubihsm.rs

- Model is:
  - UserProfile - Person
  - Device - Device. Devices only support 1 user each right now.
- Auth model for:
  - Person is authenticated to this UserProfile - Someone steals a device and tries to use it to run code on other devices in the network
  - Device with claim to UserProfile is actually used by UserProfile - Someone tries to spoof a user to gain access to their devices

## Debugging iOS
- Some initial stuff - https://dev.to/adimac93/tauri-mobile-for-ios-4dp6
- Had to search for `node tauri ios` in the generated files and change that to `pnpm tauri ios`
  - TODO: add an issue + repro in Tauri repo
- Kept failing with various "provisioning profile" errors. Turns out, you need to
  choose the right device to target in the top bar of the xcode IDE. Once I did that,
  the UI automatically figured out everything else. That was 3 hours of investigation.
- Got `error sending request for url (http://192.IP_ADDRESS:3000/): error trying to connect: tcp connect error: No route to host (os error 65)` - need to make sure the web server is running on `0.0.0.0`
  so that it's available to other devices on the wifi network
- XCode runs a non-interactive non-login shell for its scripts, so for e.g. Zsh
  you need to ensure that setup is in `.zshenv`


## Secure P2P Connection
- NWConnection - https://developer.apple.com/documentation/network/nwconnection
- https://www.browserstack.com/blog/building-secure-native-apps-with-self-signed-ssl-certificates-using-certificate-pinning/
- https://stackoverflow.com/questions/54452129/how-to-create-ios-nwconnection-for-tls-with-self-signed-cert
- qp2p? (supposedly works on mobile) - https://github.com/maidsafe/qp2p
- Web server system
  - Use web server peer with simple HTTPS + Websockets transport (Or QUIC/webtransport/etc where possible)
  - Can skip other transport protocols by simply implementing pass-through (which is necessary anyways)


## Release

```zsh
# Import environment variables
export $(xargs < release-env-vars)

# Run bundler command from the `/native` folder
npm run bundle
```

