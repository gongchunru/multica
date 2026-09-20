/**
 * Raise every CocoaPods target to the app's iOS deployment target.
 *
 * `expo-build-properties`' `ios.deploymentTarget` reaches pod *library*
 * targets, but not the resource-bundle targets CocoaPods generates for pods
 * that ship assets. Those keep whatever floor their podspec declares — today
 * RNSVG-RNSVGFilters (12.4), iosMath-mathFonts (6.0) and SDWebImage (9.0) —
 * and Xcode 27 refuses to build anything under 15.0, so the build fails before
 * it compiles a line.
 *
 * `react_native_post_install` does not walk those targets either, which is why
 * this has to be its own pass. Passing IPHONEOS_DEPLOYMENT_TARGET on the
 * xcodebuild command line also works, but only for command-line builds —
 * pressing Run in Xcode still fails. Patching the generated Podfile fixes both
 * and survives `expo prebuild`, which regenerates ios/ from scratch.
 *
 * Only ever raises a floor, never lowers one: a pod that legitimately requires
 * something newer keeps its own value.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const MARKER = "# multica: raise every pod target to the app's floor";

/** @type {import('expo/config-plugins').ConfigPlugin<{ deploymentTarget: string }>} */
const withPodsDeploymentTarget = (config, { deploymentTarget }) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        "Podfile",
      );
      const contents = fs.readFileSync(podfilePath, "utf8");
      if (contents.includes(MARKER)) return cfg;

      const anchor = "post_install do |installer|\n";
      if (!contents.includes(anchor)) {
        throw new Error(
          "with-pods-deployment-target: no `post_install` block in the " +
            "generated Podfile — the Expo template changed shape, so this " +
            "plugin needs a new anchor.",
        );
      }

      const snippet = `    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        floor = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if floor.nil? || floor.to_f < ${deploymentTarget}
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${deploymentTarget}'
        end
      end
    end
`;

      fs.writeFileSync(
        podfilePath,
        contents.replace(anchor, anchor + snippet),
        "utf8",
      );
      return cfg;
    },
  ]);

module.exports = withPodsDeploymentTarget;
