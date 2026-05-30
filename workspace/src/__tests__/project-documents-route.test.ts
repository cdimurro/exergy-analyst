import { GET } from "@/app/api/projects/[id]/documents/route";
import { getStorage } from "@/lib/storage";

jest.mock("@/lib/storage", () => ({
  getStorage: jest.fn(),
}));

const mockStorage = {
  getProject: jest.fn(),
  listDocuments: jest.fn(),
};

describe("project documents route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getStorage as jest.Mock).mockReturnValue(mockStorage);
  });

  it("lists uploaded documents for an existing project", async () => {
    mockStorage.getProject.mockResolvedValue({
      id: "proj-1",
      name: "Attachment project",
    });
    mockStorage.listDocuments.mockResolvedValue([
      {
        id: "doc-1",
        filename: "technical_test_report.md",
        mime_type: "text/markdown",
        size_bytes: 123,
        status: "uploaded",
        uploaded_at: "2026-05-01T00:00:00.000Z",
      },
    ]);

    const response = await GET(new Request("http://localhost/api/projects/proj-1/documents") as never, {
      params: Promise.resolve({ id: "proj-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockStorage.listDocuments).toHaveBeenCalledWith("proj-1");
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].filename).toBe("technical_test_report.md");
  });

  it("returns 404 when the project is absent", async () => {
    mockStorage.getProject.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/projects/missing/documents") as never, {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Project not found");
    expect(mockStorage.listDocuments).not.toHaveBeenCalled();
  });
});
