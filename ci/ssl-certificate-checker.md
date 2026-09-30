# ssl-certificate-checker  2026-09-30T16:26:32Z ec026a8
## install
```
npm warn deprecated lodash.isequal@4.5.0: This package is deprecated. Use require('node:util').isDeepStrictEqual instead.

added 187 packages in 3s
```
## unit tests
```
# tests 14
# pass 14
# fail 0
```
## local run on test input
```
[33mWARN[39m  Ignored attempt to charge for an event - the Actor does not use the pay-per-event pricing
[32mINFO[39m  [Status message]: Processed 5 of 5 hosts
[32mINFO[39m  [Status message]: Processed 5 of 5 hosts. Charged 4; 1 not charged (errors, blocked or invalid).
```
## items
5 items
```json
{"input": "apify.com", "checkedAt": "2026-09-30T16:26:35.968Z", "host": "apify.com", "port": 443, "status": "ok", "valid": true, "daysLeft": 108, "validFrom": "2026-07-03T00:00:00.000Z", "validTo": "2027-01-16T23:59:59.000Z", "issuer": "Amazon", "issuerCommonName": "Amazon RSA 2048 M04", "subject": "*.apify.com", "subjectAltNames": ["*.apify.com", "apifier.com", "*.apifier.com", "apify.com"], "sanCount": 4, "coversHost": true, "selfSigned": false, "trusted": true, "trustError": null, "protocol": "TLSv1.3", "cipher": "TLS_AES_128_GCM_SHA256", "alpn": "h2", "keyType": "RSA 2048", "serialNumber": "033947021329345FC779537CD9A338FD", "fingerprintSha256": "8B:70:D5:07:BC:74:55:22:2A:23:E0:08:36:D1:D8:1B:75:F1:0B:99:99:0F:E5:B8:AE:6E:9A:9C:08:F1:F9:8C", "chain": [{"subject": "*.apify.com", "issuer": "Amazon RSA 2048 M04", "validTo": "2027-01-16T23:59:59.000Z"}, {"subject": "Amazon RSA 2048 M04", "issuer": "Amazon Root CA 1", "validTo": "2030-08-23T22:26:35.000Z"}, {"subject": "Amazon Root CA 1", "issuer": "Starfield Services Root Certificate Authority - G2", "validTo": "2037-12-31T01:00:00.000Z"}, {"subject": "Starfield Services Root Certificate Authority - G2", "issuer": "Starfield Services Root Certificate Authority - G2", "validTo": "2037-12-31T23:59:59.000Z"}], "handshakeMs": 23, "issues": []}
```
```json
{"input": "this-domain-should-not-exist-570zx.com", "checkedAt": "2026-09-30T16:26:35.979Z", "host": "this-domain-should-not-exist-570zx.com", "port": 443, "status": "unreachable", "error": "Host does not exist"}
```
```json
{"input": "wrong.host.badssl.com", "checkedAt": "2026-09-30T16:26:35.977Z", "host": "wrong.host.badssl.com", "port": 443, "status": "ok", "valid": false, "daysLeft": 89, "validFrom": "2026-09-29T20:02:56.000Z", "validTo": "2026-12-28T20:02:55.000Z", "issuer": "Let's Encrypt", "issuerCommonName": "YR1", "subject": "*.badssl.com", "subjectAltNames": ["*.badssl.com", "badssl.com"], "sanCount": 2, "coversHost": false, "selfSigned": false, "trusted": false, "trustError": "ERR_TLS_CERT_ALTNAME_INVALID", "protocol": "TLSv1.2", "cipher": "ECDHE-RSA-AES128-GCM-SHA256", "alpn": "http/1.1", "keyType": "RSA 2048", "serialNumber": "065C62C1D5361BD7E6951263A67064063934", "fingerprintSha256": "10:11:54:81:3E:8F:DA:B6:BA:4F:AB:57:51:85:C1:A1:39:44:BC:EC:1D:84:9A:E2:CD:94:A0:73:49:49:97:E3", "chain": [{"subject": "*.badssl.com", "issuer": "YR1", "validTo": "2026-12-28T20:02:55.000Z"}, {"subject": "YR1", "issuer": "Root YR", "validTo": "2028-09-02T23:59:59.000Z"}, {"subject": "Root YR", "issuer": "ISRG Root X1", "validTo": "2032-09-02T23:59:59.000Z"}, {"subject": "ISRG Root X1", "issuer": "ISRG Root X1", "validTo": "2035-06-04T11:04:38.000Z"}], "handshakeMs": 207, "issues": [{"severity": "error", "code": "hostname_mismatch", "message": "Certificate does not cover wrong.host.badssl.com."}]}
```
```json
{"input": "expired.badssl.com", "checkedAt": "2026-09-30T16:26:35.977Z", "host": "expired.badssl.com", "port": 443, "status": "ok", "valid": false, "daysLeft": -4189, "validFrom": "2015-04-09T00:00:00.000Z", "validTo": "2015-04-12T23:59:59.000Z", "issuer": "COMODO CA Limited", "issuerCommonName": "COMODO RSA Domain Validation Secure Server CA", "subject": "*.badssl.com", "subjectAltNames": ["*.badssl.com", "badssl.com"], "sanCount": 2, "coversHost": true, "selfSigned": false, "trusted": false, "trustError": "CERT_HAS_EXPIRED", "protocol": "TLSv1.2", "cipher": "ECDHE-RSA-AES128-GCM-SHA256", "alpn": "http/1.1", "keyType": "RSA 2048", "serialNumber": "4AE79549FA9ABE3F100F17A478E16909", "fingerprintSha256": "BA:10:5C:E0:2B:AC:76:88:8E:CE:E4:7C:D4:EB:79:41:65:3E:9A:C9:93:B6:1B:2E:B3:DC:C8:20:14:D2:1B:4F", "chain": [{"subject": "*.badssl.com", "issuer": "COMODO RSA Domain Validation Secure Server CA", "validTo": "2015-04-12T23:59:59.000Z"}, {"subject": "COMODO RSA Domain Validation Secure Server CA", "issuer": "COMODO RSA Certification Authority", "validTo": "2029-02-11T23:59:59.000Z"}, {"subject": "COMODO RSA Certification Authority", "issuer": "AddTrust External CA Root", "validTo": "2020-05-30T10:48:38.000Z"}], "handshakeMs": 214, "issues": [{"severity": "error", "code": "expired", "message": "Certificate expired 4189 days ago (2015-04-12)."}]}
```
```json
{"input": "self-signed.badssl.com", "checkedAt": "2026-09-30T16:26:35.978Z", "host": "self-signed.badssl.com", "port": 443, "status": "ok", "valid": false, "daysLeft": 729, "validFrom": "2026-09-29T21:01:43.000Z", "validTo": "2028-09-28T21:01:43.000Z", "issuer": "BadSSL", "issuerCommonName": "*.badssl.com", "subject": "*.badssl.com", "subjectAltNames": ["*.badssl.com", "badssl.com"], "sanCount": 2, "coversHost": true, "selfSigned": true, "trusted": false, "trustError": "DEPTH_ZERO_SELF_SIGNED_CERT", "protocol": "TLSv1.2", "cipher": "ECDHE-RSA-AES128-GCM-SHA256", "alpn": "http/1.1", "keyType": "RSA 2048", "serialNumber": "FB13B2FEB3E1AD13", "fingerprintSha256": "D1:E0:FE:13:A1:E6:9C:8F:D9:6C:CA:B5:96:ED:75:F7:3A:21:14:E7:EF:C8:D9:6D:15:94:2A:53:AF:7B:33:7A", "chain": [{"subject": "*.badssl.com", "issuer": "*.badssl.com", "validTo": "2028-09-28T21:01:43.000Z"}], "handshakeMs": 269, "issues": [{"severity": "error", "code": "self_signed", "message": "Certificate is self-signed."}]}
```
