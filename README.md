# Dev Tool Thing
Entirely based on ideas from [Userland](https://www.youtube.com/watch?v=gla830WPBVU) and Plan 9.

## Resources
- Visidata - https://visidata.org
- LibreOffice plugins - https://www.libreoffice.org/discover/calc
- WebRTC considerations - https://bloggeek.me/webrtc-rtcpeerconnection-one-per-stream/
- WebRTC Leaks (public IP leak via STUN server)
  - https://www.security.org/vpn/webrtc-leak/
  - https://nordvpn.com/blog/webrtc/
- iOS setup - https://dev.to/adimac93/tauri-mobile-for-ios-4dp6


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
  - UserProfile is allowed to do X on this device - Someone steals a phone and tries to add the phone to their network
  - Person is authenticated to this UserProfile - Someone steals a device and tries to use it to run code on other devices in the network
  - Device with claim to UserProfile is actually used by UserProfile - Someone tries to spoof a user to gain access to devices on their network
  - Device is authenticated as member of network - Work laptop with spyware tries to snoop into other computers on the network

## Networking
- Oh gawd
- I guess get something working on desktop first?????
- Then... try to get plugin system working? We can see how hard it is first
- Then iOS i guess, either native or tauri

## Debugging iOS
- Some initial stuff - https://dev.to/adimac93/tauri-mobile-for-ios-4dp6
- Had to search for `node tauri ios` in the generated files and change that to `pnpm tauri ios`
  - TODO: add an issue + repro in Tauri repo
- Kept failing with various "provisioning profile" errors. Turns out, you need to
  choose the right device to target in the top bar of the xcode IDE. Once I did that,
  the UI automatically figured out everything else. That was 3 hours of investigation.
- Got `error sending request for url (http://192.IP_ADDRESS:3000/): error trying to connect: tcp connect error: No route to host (os error 65)` - need to make sure the web server is running on `0.0.0.0`
  so that it's available to other devices on the wifi network


## Secure P2P Connection
- NWConnection - https://developer.apple.com/documentation/network/nwconnection
- https://www.browserstack.com/blog/building-secure-native-apps-with-self-signed-ssl-certificates-using-certificate-pinning/
- https://stackoverflow.com/questions/54452129/how-to-create-ios-nwconnection-for-tls-with-self-signed-cert
