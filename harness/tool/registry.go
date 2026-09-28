package tool

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"uuid"

	"github.com/unreallabsai/unreal-agent/harness/operation"
	"github.com/unreallabsai/unreal-agent/internal/saferead"
)

const (
	BashName      = "Bash"
	ViewImageName = "ViewImage"
	SkillUseName  = "SkillUse"
)

type registry struct {
	// The selection is copied at construction and never mutated; reads need no lock.
	enabled map[string]struct{}

	mu                sync.RWMutex
	staticTranslators map[string]Translator
	extraDefinitions  []Definition
	skills            map[RegistrationID]Skill
	skillIDsByPath    map[string]RegistrationID
	skillOrder        []RegistrationID
}

var _ Registry = (*registry)(nil)

type StaticTranslators struct {
	Bash      Translator
	ViewImage Translator
	Extra     []ExtraStaticTool
}

type ExtraStaticTool struct {
	Definition Definition
	Translator Translator
}

func NewRegistry(configured StaticTranslators, enabled ...string) Registry {
	current := &registry{
		enabled:        make(map[string]struct{}, len(enabled)),
		skills:         make(map[RegistrationID]Skill),
		skillIDsByPath: make(map[string]RegistrationID),
	}
	for _, name := range enabled {
		current.enabled[name] = struct{}{}
	}
	if configured.Bash == nil {
		configured.Bash = unavailableTranslator{name: BashName}
	}
	if configured.ViewImage == nil {
		configured.ViewImage = unavailableTranslator{name: ViewImageName}
	}
	current.staticTranslators = map[string]Translator{
		BashName:      configured.Bash,
		ViewImageName: configured.ViewImage,
		SkillUseName:  &skillUseTranslator{registry: current},
	}
	for _, extra := range configured.Extra {
		name := extra.Definition.Tool.Name
		if name == "" || extra.Translator == nil {
			continue
		}
		if _, reserved := current.staticTranslators[name]; reserved {
			continue
		}
		current.staticTranslators[name] = extra.Translator
		current.extraDefinitions = append(current.extraDefinitions, extra.Definition)
	}
	return current
}

func (current *registry) StaticDefinitions() []Definition {
	var definitions []Definition
	for _, definition := range staticDefinitions() {
		if _, enabled := current.enabled[definition.Tool.Name]; enabled {
			definitions = append(definitions, definition)
		}
	}
	for _, definition := range current.extraDefinitions {
		if _, enabled := current.enabled[definition.Tool.Name]; enabled {
			definitions = append(definitions, definition)
		}
	}
	return definitions
}

func (current *registry) Resolve(name string) (Translator, bool) {
	if translator, exists := current.staticTranslators[name]; exists {
		if _, enabled := current.enabled[name]; !enabled {
			return nil, false
		}
		return translator, true
	}
	return nil, false
}

func (current *registry) RegisterSkill(skill Skill) (RegistrationID, error) {
	if err := validateSkill(skill); err != nil {
		return uuid.Nil(), err
	}
	current.mu.Lock()
	defer current.mu.Unlock()
	if _, exists := current.skillIDsByPath[skill.Path]; exists {
		return uuid.Nil(), fmt.Errorf("skill path %q is already registered", skill.Path)
	}
	for _, registered := range current.skills {
		if registered.Name == skill.Name {
			return uuid.Nil(), fmt.Errorf("skill name %q is already registered", skill.Name)
		}
	}
	id := uuid.New()
	current.skills[id] = skill
	current.skillIDsByPath[skill.Path] = id
	current.skillOrder = append(current.skillOrder, id)
	return id, nil
}

func validateSkill(skill Skill) error {
	if strings.TrimSpace(skill.Path) == "" {
		return errors.New("skill path must be set")
	}
	if strings.TrimSpace(skill.Name) == "" {
		return errors.New("skill name must be set")
	}
	if strings.TrimSpace(skill.Description) == "" {
		return errors.New("skill description must be set")
	}
	return nil
}

func (current *registry) UnregisterSkill(id RegistrationID) {
	if id == uuid.Nil() {
		return
	}
	current.mu.Lock()
	defer current.mu.Unlock()
	skill, exists := current.skills[id]
	if !exists {
		return
	}
	delete(current.skills, id)
	delete(current.skillIDsByPath, skill.Path)
	current.skillOrder = removeRegistrationID(current.skillOrder, id)
}

func (current *registry) Skills() []Skill {
	current.mu.RLock()
	defer current.mu.RUnlock()
	result := make([]Skill, 0, len(current.skills))
	for _, id := range current.skillOrder {
		result = append(result, current.skills[id])
	}
	return result
}

func (current *registry) resolveSkill(name string) (Skill, bool) {
	current.mu.RLock()
	defer current.mu.RUnlock()
	for _, id := range current.skillOrder {
		skill := current.skills[id]
		if skill.Name == name {
			return skill, true
		}
	}
	return Skill{}, false
}

func DiscoverSkills(directory string) ([]Skill, []error) {
	const maxSkillDirectories = 128
	const maxSkillTotalBytes = 4 * 1024 * 1024
	info, err := os.Lstat(directory)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, []error{fmt.Errorf("find skills: %w", err)}
	}
	if !info.IsDir() {
		return nil, []error{fmt.Errorf("skill directory %q is not a regular directory", directory)}
	}
	parent, err := os.Lstat(filepath.Dir(directory))
	if err != nil {
		return nil, []error{fmt.Errorf("inspect skill parent directory: %w", err)}
	}
	if !parent.IsDir() {
		return nil, []error{fmt.Errorf("skill parent directory %q is not a regular directory", filepath.Dir(directory))}
	}
	dir, err := os.Open(directory)
	if err != nil {
		return nil, []error{fmt.Errorf("open skills directory: %w", err)}
	}
	names, readErr := dir.Readdirnames(maxSkillDirectories + 1)
	closeErr := dir.Close()
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return nil, []error{fmt.Errorf("list skills: %w", readErr)}
	}
	if closeErr != nil {
		return nil, []error{fmt.Errorf("close skills directory: %w", closeErr)}
	}
	if len(names) > maxSkillDirectories {
		return nil, []error{fmt.Errorf("skill directory exceeds %d entries", maxSkillDirectories)}
	}
	sort.Strings(names)

	var skills []Skill
	var skillErrors []error
	skillNames := make(map[string]struct{})
	totalBytes := 0
	for _, name := range names {
		skillDirectory := filepath.Join(directory, name)
		entry, err := os.Lstat(skillDirectory)
		if err != nil {
			skillErrors = append(skillErrors, fmt.Errorf("inspect skill directory %q: %w", skillDirectory, err))
			continue
		}
		if !entry.IsDir() {
			if entry.Mode()&os.ModeSymlink != 0 {
				skillErrors = append(skillErrors, fmt.Errorf("skill directory %q is a link", skillDirectory))
			}
			continue
		}
		path := filepath.Join(skillDirectory, "SKILL.md")
		contents, err := saferead.RegularFile(path, operation.MaxSkillContentBytes)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			skillErrors = append(skillErrors, fmt.Errorf("read skill %q: %w", path, err))
			continue
		}
		totalBytes += len(contents)
		if totalBytes > maxSkillTotalBytes {
			skillErrors = append(skillErrors, fmt.Errorf("skill directory exceeds %d bytes", maxSkillTotalBytes))
			break
		}
		frontmatter, err := parseSkillFrontmatter(contents)
		if err != nil {
			skillErrors = append(skillErrors, fmt.Errorf("parse skill %q: %w", path, err))
			continue
		}
		skill := Skill{
			Name:        strings.TrimSpace(frontmatter.Name),
			Description: strings.TrimSpace(frontmatter.Description),
			Path:        path,
		}
		if err := validateSkill(skill); err != nil {
			skillErrors = append(skillErrors, fmt.Errorf("validate skill %q: %w", path, err))
			continue
		}
		if _, exists := skillNames[skill.Name]; exists {
			skillErrors = append(skillErrors, fmt.Errorf("skill %q: duplicate name %q", path, skill.Name))
			continue
		}
		skillNames[skill.Name] = struct{}{}
		skills = append(skills, skill)
	}
	return skills, skillErrors
}

type skillFrontmatter struct {
	Name        string
	Description string
}

func parseSkillFrontmatter(contents []byte) (skillFrontmatter, error) {
	scanner := bufio.NewScanner(bytes.NewReader(contents))
	if !scanner.Scan() || strings.TrimSpace(scanner.Text()) != "---" {
		return skillFrontmatter{}, errors.New("missing opening YAML frontmatter delimiter")
	}

	var metadata skillFrontmatter
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "---" {
			return metadata, nil
		}
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		switch key {
		case "name":
			metadata.Name = strings.TrimSpace(value)
		case "description":
			metadata.Description = strings.TrimSpace(value)
		}
	}
	if err := scanner.Err(); err != nil {
		return skillFrontmatter{}, fmt.Errorf("read YAML frontmatter: %w", err)
	}
	return skillFrontmatter{}, errors.New("missing closing YAML frontmatter delimiter")
}

func removeRegistrationID(ids []RegistrationID, target RegistrationID) []RegistrationID {
	for index, id := range ids {
		if id != target {
			continue
		}
		copy(ids[index:], ids[index+1:])
		ids[len(ids)-1] = uuid.Nil()
		return ids[:len(ids)-1]
	}
	return ids
}
