using System.Diagnostics;
using System.Text.Json;
using PhoneBox.Agent;
using Xunit;

/// <summary>
/// Updating PhoneBox.app (the macOS disk image): finding the app an agent runs from, picking the .dmg of a release, and
/// replacing the app from a real disk image. The image test needs hdiutil, so it only runs on a Mac.
/// </summary>
public class UpdateBundleTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "phonebox-bundle-" + Guid.NewGuid().ToString("N"));

    public UpdateBundleTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Theory]
    [InlineData("/Applications/PhoneBox.app/Contents/MacOS/", "/Applications/PhoneBox.app")]
    [InlineData("/Users/me/Applications/PhoneBox.app/Contents/MacOS", "/Users/me/Applications/PhoneBox.app")]
    [InlineData("/Users/me/.local/share/phonebox/app/", null)]
    [InlineData("/Applications/Contents/MacOS/", null)] // a folder that is not an app
    [InlineData("/Users/me/dev/phonebox/agent/PhoneBox.Agent/bin/Release/net10.0/osx-arm64/publish/", null)]
    public void TheAppAnAgentRunsFromIsFoundOnlyInsideABundle(string baseDirectory, string? expected)
    {
        if (OperatingSystem.IsWindows()) return;
        Assert.Equal(expected, UpdateService.BundleDir(baseDirectory));
    }

    [Fact]
    public void TheDiskImageOfThisMachineIsPickedAndNotTheOtherOnesOrTheZip()
    {
        using var doc = JsonDocument.Parse("""
            { "tag_name": "v1.2.0", "html_url": "https://example.invalid", "assets": [
              { "name": "PhoneBox-1.2.0.apk", "browser_download_url": "https://example.invalid/PhoneBox-1.2.0.apk" },
              { "name": "PhoneBox-1.2.0-osx-arm64.dmg", "browser_download_url": "https://example.invalid/PhoneBox-1.2.0-osx-arm64.dmg" },
              { "name": "PhoneBox-1.2.0-osx-x64.dmg", "browser_download_url": "https://example.invalid/PhoneBox-1.2.0-osx-x64.dmg" },
              { "name": "PhoneBoxAgent-1.2.0-osx-arm64.zip", "browser_download_url": "https://example.invalid/PhoneBoxAgent-1.2.0-osx-arm64.zip" } ] }
            """);
        var arm = UpdateService.SelectAssets(doc.RootElement, "osx-arm64");
        Assert.Equal("PhoneBox-1.2.0-osx-arm64.dmg", UpdateService.AssetName(arm.AgentDmg!));
        Assert.Equal("PhoneBoxAgent-1.2.0-osx-arm64.zip", UpdateService.AssetName(arm.AgentZip!));
        Assert.Equal("PhoneBox-1.2.0.apk", UpdateService.AssetName(arm.Apk!)); // a .dmg is never taken for the phone app
        Assert.Equal("PhoneBox-1.2.0-osx-x64.dmg", UpdateService.AssetName(UpdateService.SelectAssets(doc.RootElement, "osx-x64").AgentDmg!));
        Assert.Null(UpdateService.SelectAssets(doc.RootElement, "linux-x64").AgentDmg);
    }

    [Fact]
    public void AReleaseBeforeTheDiskImagesHasNone()
    {
        using var doc = JsonDocument.Parse("""
            { "tag_name": "v0.9.9", "html_url": "https://example.invalid", "assets": [
              { "name": "PhoneBoxAgent-0.9.9-osx-arm64.zip", "browser_download_url": "https://example.invalid/PhoneBoxAgent-0.9.9-osx-arm64.zip" } ] }
            """);
        Assert.Null(UpdateService.SelectAssets(doc.RootElement, "osx-arm64").AgentDmg);
    }

    private string MakeApp(string folder, string marker)
    {
        var app = Path.Combine(_root, folder, "PhoneBox.app");
        Directory.CreateDirectory(Path.Combine(app, "Contents", "MacOS"));
        File.WriteAllText(Path.Combine(app, "Contents", "MacOS", "PhoneBoxAgent"), marker);
        return app;
    }

    [Fact]
    public void SwappingReplacesTheAppAndLeavesNothingBehind()
    {
        var app = MakeApp("apps", "old");
        var staging = MakeApp("apps-new", "new");
        var parent = Path.GetDirectoryName(app)!;
        var stagingInParent = Path.Combine(parent, ".PhoneBox-update.app");
        Directory.Move(staging, stagingInParent);

        UpdateService.SwapBundle(app, stagingInParent);

        Assert.Equal("new", File.ReadAllText(Path.Combine(app, "Contents", "MacOS", "PhoneBoxAgent")));
        Assert.Equal([app], Directory.GetDirectories(parent));
    }

    [Fact]
    public void ASwapThatFailsPutsTheOldAppBack()
    {
        var app = MakeApp("apps", "old");
        var missing = Path.Combine(Path.GetDirectoryName(app)!, ".PhoneBox-update.app"); // nothing was staged

        Assert.ThrowsAny<IOException>(() => UpdateService.SwapBundle(app, missing));

        Assert.Equal("old", File.ReadAllText(Path.Combine(app, "Contents", "MacOS", "PhoneBoxAgent")));
    }

    [Fact]
    public async Task AppIsCopiedOutOfARealDiskImageAndTheImageIsDetached()
    {
        if (!OperatingSystem.IsMacOS()) return;
        var src = Path.Combine(_root, "image-src");
        var app = MakeApp("image-src", "from-the-image");
        File.WriteAllText(Path.Combine(app, "Contents", "Info.plist"), "<plist/>");
        var dmg = Path.Combine(_root, "PhoneBox-test.dmg");
        var create = Process.Start(new ProcessStartInfo("/usr/bin/hdiutil", ["create", "-volname", "PhoneBoxTest", "-srcfolder", src, "-format", "UDZO", dmg])
            { RedirectStandardOutput = true, RedirectStandardError = true })!;
        await create.WaitForExitAsync();
        Assert.Equal(0, create.ExitCode);

        var destination = Path.Combine(_root, "extracted", "PhoneBox.app");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await UpdateService.ExtractAppAsync(dmg, destination, CancellationToken.None);

        Assert.Equal("from-the-image", File.ReadAllText(Path.Combine(destination, "Contents", "MacOS", "PhoneBoxAgent")));
        var mounted = Process.Start(new ProcessStartInfo("/sbin/mount") { RedirectStandardOutput = true })!;
        var listing = await mounted.StandardOutput.ReadToEndAsync();
        Assert.DoesNotContain("PhoneBoxTest", listing);
    }

    [Fact]
    public async Task ADiskImageWithoutTheAppIsRefused()
    {
        if (!OperatingSystem.IsMacOS()) return;
        var src = Path.Combine(_root, "empty-src");
        Directory.CreateDirectory(src);
        File.WriteAllText(Path.Combine(src, "readme.txt"), "no app here");
        var dmg = Path.Combine(_root, "empty.dmg");
        var create = Process.Start(new ProcessStartInfo("/usr/bin/hdiutil", ["create", "-volname", "PhoneBoxEmpty", "-srcfolder", src, "-format", "UDZO", dmg])
            { RedirectStandardOutput = true, RedirectStandardError = true })!;
        await create.WaitForExitAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            UpdateService.ExtractAppAsync(dmg, Path.Combine(_root, "never", "PhoneBox.app"), CancellationToken.None));
        Assert.Contains("no PhoneBox.app", error.Message);
    }
}

public class UpdateBundleSigningTests
{
    private const string Certificate = "identifier \"net.oxog.phonebox.agent\" and certificate leaf = H\"cf6ad85695a84739b74f60e8a9700f13881707ce\"";

    [Fact]
    public void TheRequirementIsReadFromCodesignsOutput()
    {
        var output = "Executable=/Applications/PhoneBox.app/Contents/MacOS/PhoneBoxAgent\n# designated => something old\ndesignated => " + Certificate + "\n";
        Assert.Equal(Certificate, UpdateService.ParseDesignatedRequirement(output));
        Assert.Null(UpdateService.ParseDesignatedRequirement("code object is not signed at all"));
    }

    [Theory]
    [InlineData(Certificate, false)]
    [InlineData("identifier \"x\" and anchor apple generic and certificate root = H\"abcdef\"", false)]
    [InlineData("identifier \"x\" and info[CFBundleVersion] >= \"1\"", false)] // not a certificate form, still enforced
    [InlineData("cdhash H\"9217e8b460b7d216df7b9665c1e608edacfe0319\"", true)] // ad hoc: only a hash, nothing to pin
    [InlineData("cdhash H\"9217e8b460b7d216df7b9665c1e608edacfe0319\" and identifier \"x\"", false)]
    [InlineData("cdhash H\"9217e8b460b7d216df7b9665c1e608edacfe0319\" or anchor apple generic", false)] // a disjunction is not a plain hash
    [InlineData("anchor apple generic or cdhash H\"9217e8b460b7d216df7b9665c1e608edacfe0319\"", false)]
    [InlineData(" cdhash H\"9217e8b460b7d216df7b9665c1e608edacfe0319\" \n", true)]
    public void OnlyARequirementThatIsJustACodeHashSkipsThePin(string requirement, bool codeHashOnly) =>
        Assert.Equal(codeHashOnly, UpdateService.CodeHashOnly(requirement));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AnEmptyRequirementIsRefusedNotTreatedAsAdHoc(string? requirement) =>
        Assert.Throws<InvalidOperationException>(() => UpdateService.CodeHashOnly(requirement));

    [Fact]
    public void TheRestartPathCanBeReadBeforeTheAppMoves()
    {
        AppRestart.Executable = "/Applications/PhoneBox.app/Contents/MacOS/PhoneBoxAgent";
        try { Assert.Equal("/Applications/PhoneBox.app/Contents/MacOS/PhoneBoxAgent", AppRestart.Executable); }
        finally { AppRestart.Executable = null; }
    }
}

public class UpdateBundleStrictnessTests
{
    [Fact]
    public async Task AnUnsignedAppHasNoRequirementToReadAndThatIsAnErrorNotAnAdHocCopy()
    {
        if (!OperatingSystem.IsMacOS()) return;
        var dir = Path.Combine(Path.GetTempPath(), "phonebox-unsigned-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var file = Path.Combine(dir, "unsigned");
            await File.WriteAllTextAsync(file, "#!/bin/sh\n");
            await Assert.ThrowsAsync<InvalidOperationException>(() => UpdateService.DesignatedRequirementAsync(file, CancellationToken.None));
        }
        finally { Directory.Delete(dir, true); }
    }
}
