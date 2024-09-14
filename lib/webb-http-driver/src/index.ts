import {
  ConnectionDriver,
  ConnectionDriverInit,
  ConnectionRegisterInfo,
  Datagram,
  NetworkContext,
  RawDatagram,
} from "@a1liu/webb-tools/network";

class HttpDriver implements ConnectionDriver {
  readonly id = "HttpDriver";

  constructor(fields: ConnectionDriverInit) {
    console.log("creating", fields);
  }

  registerConnection({
    peerDeviceId,
    additionalInfo,
  }: ConnectionRegisterInfo): Promise<{ success: boolean }> {
    console.log("registering ", peerDeviceId, additionalInfo);
    throw new Error("Method not implemented.");
  }
  sendDatagram<T>(datagram: Datagram<T>, ctx?: NetworkContext): Promise<void> {
    console.log("Sending ", datagram, ctx);
    throw new Error("Method not implemented.");
  }
  receiveDatagram(channel: string, ctx?: NetworkContext): Promise<RawDatagram> {
    console.log("receiving ", channel, ctx);
    throw new Error("Method not implemented.");
  }
  close(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

export function createHttpDriver(
  fields: ConnectionDriverInit,
): ConnectionDriver {
  return new HttpDriver(fields);
}
