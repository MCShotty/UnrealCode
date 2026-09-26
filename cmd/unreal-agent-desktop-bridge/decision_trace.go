package main

type decisionTrace struct {
	decisionResult
	ID        string                      `json:"id"`
	Purpose   string                      `json:"purpose"`
	Questions map[string]decisionQuestion `json:"questions"`
	Evidence  any                         `json:"evidence"`
}

func traceDecision(result decisionResult, batch decisionBatch, id, purpose string) decisionTrace {
	return decisionTrace{decisionResult: result, ID: id, Purpose: purpose, Questions: batch.Questions, Evidence: batch.State}
}
