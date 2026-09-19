using System.Net;
using System.Net.Http.Json;
using PolyglotLab.Core;

var failures = 0;

void Check(string name, Action test)
{
    try { test(); Console.WriteLine($"PASS {name}"); }
    catch (Exception error) { failures++; Console.Error.WriteLine($"FAIL {name}: {error.Message}"); }
}

Check("seeded catalog", () =>
{
    var catalog = new WorkCatalog();
    if (catalog.All().Count != 3) throw new Exception("Expected three work items.");
});

Check("extended dataset", () =>
{
    if (new WorkCatalog("extended").All().Count != 5) throw new Exception("Expected five work items.");
});

Check("validation", () =>
{
    var catalog = new WorkCatalog();
    try { catalog.Add(" "); throw new Exception("Invalid title was accepted."); }
    catch (ArgumentException) { }
});

Check("create and complete", () =>
{
    var catalog = new WorkCatalog();
    var item = catalog.Add("  Test the API  ");
    if (item.Title != "Test the API") throw new Exception("Title was not trimmed.");
    if (catalog.Complete(item.Id)?.Completed != true) throw new Exception("Item was not completed.");
    if (catalog.Complete(999) is not null) throw new Exception("Unknown item was completed.");
});

if (args.Length > 0 && args[0] == "--integration")
{
    var baseUrl = args.Length > 1 ? args[1] : "http://127.0.0.1:5087";
    using var client = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(4) };
    try
    {
        var health = await client.GetAsync("/api/health");
        if (health.StatusCode != HttpStatusCode.OK) throw new Exception($"Health returned {health.StatusCode}.");
        Console.WriteLine("PASS API health");

        var created = await client.PostAsJsonAsync("/api/work", new { title = "Integration check" });
        if (created.StatusCode != HttpStatusCode.Created) throw new Exception($"Create returned {created.StatusCode}.");
        var item = await created.Content.ReadFromJsonAsync<WorkItem>();
        if (item is null) throw new Exception("No created item returned.");
        Console.WriteLine("PASS API create");

        var completed = await client.PostAsync($"/api/work/{item.Id}/complete", null);
        if (completed.StatusCode != HttpStatusCode.OK) throw new Exception($"Complete returned {completed.StatusCode}.");
        Console.WriteLine("PASS API complete");
    }
    catch (Exception error)
    {
        failures++;
        Console.Error.WriteLine($"FAIL API integration: {error.Message}");
    }
}

Console.WriteLine($"{failures} failure(s)");
return failures == 0 ? 0 : 1;
