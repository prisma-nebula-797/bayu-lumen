using System.Text;
using System.Text.Json;
using PhoneBox.Agent;
using Xunit;

namespace PhoneBox.Agent.Tests;

// The Keyboard widget types on the PC through the trackpad channel. It has its own switch: a Keyboard widget with
// "control" on, on an enabled page. Mouse control does not allow typing and typing does not allow the mouse.
[Collection("KeySenderSinks")]
public class KeyboardWidgetTests : IDisposable
{
    private readonly List<(string Kind, string Value)> _keys = [];
    private readonly List<KeySender.MouseCall> _mouse = [];

    public KeyboardWidgetTests()
    {
        TrackpadHandler.TestKeyboardSink = (kind, value) => _keys.Add((kind, value));
        KeySender.TestMouseSink = call => _mouse.Add(call);
    }

    public void Dispose()
    {
        TrackpadHandler.TestKeyboardSink = null;
        KeySender.TestMouseSink = null;
    }

    private static ConfigStore Store(string widgetsJson, out string file)
    {
        file = Path.Combine(Path.GetTempPath(), "phonebox-keyboard-test-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(file, $$"""{"pages":[{"enabled":true,"widgets":{{widgetsJson}}}]}""");
        return new ConfigStore(file);
    }

    private static byte[] Json(object o) => Encoding.UTF8.GetBytes(JsonSerializer.Serialize(o));

    [Fact]
    public void KeyboardNeedsItsOwnWidgetOnAnEnabledPage()
    {
        var opts = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.False(TrackpadHandler.IsKeyboardAllowed(new AgentConfig()));
        Assert.False(TrackpadHandler.IsKeyboardAllowed(JsonSerializer.Deserialize<AgentConfig>(
            """{"pages":[{"enabled":true,"widgets":[{"type":"keyboard"}]}]}""", opts)!));
        Assert.False(TrackpadHandler.IsKeyboardAllowed(JsonSerializer.Deserialize<AgentConfig>(
            """{"pages":[{"enabled":false,"widgets":[{"type":"keyboard","options":{"control":true}}]}]}""", opts)!));
        // a trackpad with mouse control on does not open typing
        Assert.False(TrackpadHandler.IsKeyboardAllowed(JsonSerializer.Deserialize<AgentConfig>(
            """{"pages":[{"enabled":true,"widgets":[{"type":"trackpad","options":{"control":true}}]}]}""", opts)!));
        Assert.True(TrackpadHandler.IsKeyboardAllowed(JsonSerializer.Deserialize<AgentConfig>(
            """{"pages":[{"enabled":true,"widgets":[{"type":"keyboard","options":{"control":true}}]}]}""", opts)!));
    }

    [Fact]
    public void TypingIsRefusedWhileKeyboardControlIsOff()
    {
        var store = Store("""[{"type":"keyboard","options":{"control":false}},{"type":"trackpad","options":{"control":true}}]""", out var file);
        try
        {
            TrackpadHandler.ProcessPayload(Json(new { type = "text", text = "hello" }), store);
            TrackpadHandler.ProcessPayload(Json(new { type = "key", keys = "ctrl+c" }), store);
            Assert.Empty(_keys);
            // the trackpad still works on its own switch
            TrackpadHandler.ProcessPayload(Json(new { type = "click" }), store);
            Assert.Single(_mouse);
        }
        finally { File.Delete(file); }
    }

    [Fact]
    public void KeyboardControlDoesNotOpenTheMouse()
    {
        var store = Store("""[{"type":"keyboard","options":{"control":true}}]""", out var file);
        try
        {
            TrackpadHandler.ProcessPayload(Json(new { type = "move", dx = 10, dy = 10 }), store);
            TrackpadHandler.ProcessPayload(Json(new { type = "click" }), store);
            Assert.Empty(_mouse);
            TrackpadHandler.ProcessPayload(Json(new { type = "text", text = "Halo, PC! é😀" }), store);
            Assert.Equal([("text", "Halo, PC! é😀")], _keys);
        }
        finally { File.Delete(file); }
    }

    [Fact]
    public void KeyCombosAreParsedAndUnknownOrListedKeysRefused()
    {
        var store = Store("""[{"type":"keyboard","options":{"control":true}}]""", out var file);
        try
        {
            TrackpadHandler.ProcessPayload(Json(new { type = "key", keys = "Ctrl+Shift+Escape" }), store);
            TrackpadHandler.ProcessPayload(Json(new { type = "key", keys = "backspace" }), store);
            TrackpadHandler.ProcessPayload(Json(new { type = "key", keys = "ctrl+c, ctrl+v" }), store); // a list: refused
            TrackpadHandler.ProcessPayload(Json(new { type = "key", keys = "ctrl+nosuchkey" }), store); // unknown: refused
            TrackpadHandler.ProcessPayload(Json(new { type = "key", keys = "" }), store);
            Assert.Equal([("key", "ctrl+shift+esc"), ("key", "backspace")], _keys);
        }
        finally { File.Delete(file); }
    }

    [Fact]
    public void LongTextAndControlCharactersAreNotTyped()
    {
        var store = Store("""[{"type":"keyboard","options":{"control":true}}]""", out var file);
        try
        {
            TrackpadHandler.ProcessPayload(Json(new { type = "text", text = new string('a', TrackpadHandler.MaxTextLength + 1) }), store);
            Assert.Empty(_keys);
            TrackpadHandler.ProcessPayload(Json(new { type = "text", text = "a\u0007b\r\nc\u001b" }), store);
            Assert.Equal([("text", "ab\nc")], _keys);
            TrackpadHandler.ProcessPayload(Json(new { type = "text", text = "\u0007\u001b" }), store);
            Assert.Single(_keys);
        }
        finally { File.Delete(file); }
    }
}
