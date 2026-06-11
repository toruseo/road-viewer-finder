/**
 * dataWorker - GeoJSONの解凍・パース・バイナリ変換をメインスレッド外で実行する。
 * 重い処理（gzip解凍、200MB級のJSON.parse、簡略化、セル分割）を全て引き受け、
 * 転送可能なTypedArrayバンドルだけをメインスレッドへ返す。
 */
import { processTier } from './dataProcessor.js';

self.onmessage = (e) => {
  const { fclass, bytes } = e.data;
  try {
    const bundle = processTier(bytes, fclass);
    const transfer = bundle.transfer;
    delete bundle.transfer;
    self.postMessage({ ok: true, bundle }, transfer);
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.stack) || err) });
  }
};
