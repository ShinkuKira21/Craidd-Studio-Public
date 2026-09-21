namespace PolyglotLab.Core;

public sealed record WorkItem(int Id, string Title, bool Completed);

public sealed class WorkCatalog
{
    private readonly object _gate = new();
    private readonly List<WorkItem> _items;
    private int _nextId;

    public WorkCatalog(string dataset = "small")
    {
        _items = new List<WorkItem>
        {
            new(1, "Open the project picker", false),
            new(2, "Run the C# API", false),
            new(3, "Connect the Tauri window", false),
        };
        if (dataset.Equals("extended", StringComparison.OrdinalIgnoreCase))
        {
            _items.Add(new(4, "Try a Release profile", false));
            _items.Add(new(5, "Inspect a build problem", false));
        }
        _nextId = _items.Count + 1;
    }

    public IReadOnlyList<WorkItem> All()
    {
        lock (_gate) return _items.ToArray();
    }

    public WorkItem Add(string? title)
    {
        var clean = title?.Trim() ?? "";
        if (clean.Length is < 2 or > 80)
            throw new ArgumentException("Title must contain 2 to 80 characters.", nameof(title));

        lock (_gate)
        {
            var item = new WorkItem(_nextId++, clean, false);
            _items.Add(item);
            return item;
        }
    }

    public WorkItem? Complete(int id)
    {
        lock (_gate)
        {
            var index = _items.FindIndex(item => item.Id == id);
            if (index < 0) return null;
            _items[index] = _items[index] with { Completed = true };
            return _items[index];
        }
    }
}
