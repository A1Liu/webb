# Dev Tool Thing
Entirely based on ideas from [Userland](https://www.youtube.com/watch?v=gla830WPBVU) and Plan 9.

## Resources
- Visidata - https://visidata.org
- LibreOffice plugins - https://www.libreoffice.org/discover/calc
- WebRTC considerations - https://bloggeek.me/webrtc-rtcpeerconnection-one-per-stream/

### IO
- Virtual Camera with CoreMediaIO - https://developer.apple.com/documentation/coremediaio
- Mounting userspace-managed file system with FUSE - https://github.com/jmillikin/rust-fuse

### Auth
- WebAuthn - https://webauthn.guide/
- Biometric auth - https://stackoverflow.blog/2022/11/16/biometric-authentication-for-web-devs/
- Authenticator rs - https://github.com/mozilla/authenticator-rs/
- https://developers.yubico.com/WebAuthn/WebAuthn_Developer_Guide/Platform_vs_Cross-Platform.html
- MacOS/iOS LocalAuthentication - https://lib.rs/crates/localauthentication-rs

- Model is:
  - UserProfile - Person
  - Device - a UserProfile requires platform auth, otherwise they're guest user
  - Network - connected set of devices, owned by a single UserProfile
- Auth model for:
  - UserProfile is allowed to do X on this device
  - Person is authenticated to this UserProfile
  - Device with claim to UserProfile is actually used by UserProfile
