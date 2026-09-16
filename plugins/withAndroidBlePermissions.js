const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const LOCATION_PERMISSIONS = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
];

function upsertPermission(permissions, name, attributes) {
  const permission = permissions.find((entry) => entry.$['android:name'] === name);
  if (permission) {
    permission.$ = { ...permission.$, ...attributes, 'android:name': name };
    return;
  }
  permissions.push({ $: { 'android:name': name, ...attributes } });
}

module.exports = function withAndroidBlePermissions(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const androidManifest = nextConfig.modResults;
    AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);

    const manifest = androidManifest.manifest;
    const permissions = (manifest['uses-permission'] ??= []);
    const sdk23Permissions = (manifest['uses-permission-sdk-23'] ??= []);

    for (const name of LOCATION_PERMISSIONS) {
      const legacyAttributes = { 'android:maxSdkVersion': '30' };
      upsertPermission(sdk23Permissions, name, legacyAttributes);
      upsertPermission(permissions, name, {
        ...legacyAttributes,
        'tools:replace': 'android:maxSdkVersion',
      });
    }

    upsertPermission(permissions, 'android.permission.BLUETOOTH_SCAN', {
      'android:usesPermissionFlags': 'neverForLocation',
      'tools:targetApi': '31',
    });

    return nextConfig;
  });
};
